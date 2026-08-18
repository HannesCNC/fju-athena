const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const app = express();
app.use(express.json({ limit: '5mb' }));
const allowed = (process.env.ALLOWED_ORIGINS || 'https://richlab.online,https://www.richlab.online,http://localhost:8000').split(',').map(s=>s.trim());
app.use(cors({ origin(origin, cb){ if(!origin || allowed.includes(origin)) return cb(null,true); return cb(new Error('Origin not allowed')); } }));

const DATA_PATH = process.env.ATHENA_DATA_PATH || path.join(__dirname, 'athena-knowledge.json');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';

function loadKB(){ try{return JSON.parse(fs.readFileSync(DATA_PATH,'utf8'));}catch(e){return [];} }
function saveKB(items){ fs.mkdirSync(path.dirname(DATA_PATH),{recursive:true}); fs.writeFileSync(DATA_PATH, JSON.stringify(items,null,2)); }
function tokens(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9$]+/g,' ').split(/\s+/).filter(x=>x.length>1); }
function score(item, question){ const q=new Set(tokens(question)); let s=0; for(const t of tokens(item.title+' '+(item.keywords||[]).join(' ')+' '+item.content)){ if(q.has(t)) s+=1; } s += (item.authority||0)/100; if(item.valid_until && new Date(item.valid_until) < new Date()) s -= 3; return s; }
function retrieve(question){ return loadKB().map(x=>({...x,_score:score(x,question)})).sort((a,b)=>b._score-a._score).filter(x=>x._score>1).slice(0,8); }
function admin(req,res,next){ if(!process.env.ATHENA_ADMIN_KEY) return res.status(503).json({error:'ATHENA_ADMIN_KEY is not configured.'}); if(req.get('X-Admin-Key')!==process.env.ATHENA_ADMIN_KEY) return res.status(401).json({error:'Invalid admin key.'}); next(); }

app.get('/health',(req,res)=>res.json({ok:true,service:'FJU Athena'}));

app.post('/api/athena/ask', async (req,res)=>{
  try{
    const question=String(req.body?.question||'').trim();
    if(!question) return res.status(400).json({error:'Please enter a question.'});
    if(question.length>1200) return res.status(400).json({error:'Question is too long.'});
    const sources=retrieve(question);
    if(!sources.length) return res.json({answer:"I don't have enough reliable FJU information to answer that yet. Try asking in a different way, or ask an administrator to add the missing information.",sources:[]});
    const context=sources.map((s,i)=>`SOURCE ${i+1}\nTitle: ${s.title}\nType: ${s.source_type}\nAuthority: ${s.authority||0}\nDate: ${s.date||'unknown'}\nValid until: ${s.valid_until||'not specified'}\nContent: ${s.content}`).join('\n\n');
    const prompt=`You are FJU Athena, an independent student guidance assistant. Answer only from the supplied sources. Prefer newer official FJU information over older course material, and course material over student reports. Clearly label student reports as unconfirmed if they are used. If sources conflict, say so and explain which source should take priority. Do not invent deadlines, links, rules, or platform status. Keep the answer practical, plain-English, and usually under 180 words.\n\nQUESTION:\n${question}\n\nSOURCES:\n${context}`;
    const response=await client.responses.create({model:MODEL,input:prompt});
    const answer=response.output_text?.trim() || 'I found relevant information but could not produce an answer.';
    res.json({answer,sources:sources.slice(0,5).map(({id,title,source_type,date,valid_until})=>({id,title,source_type,date,valid_until}))});
  }catch(err){ console.error(err); res.status(500).json({error:'Athena is temporarily unavailable.'}); }
});

app.get('/api/athena/knowledge', admin, (req,res)=>{ res.json({items:loadKB().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))}); });
app.post('/api/athena/knowledge', admin, (req,res)=>{
  const b=req.body||{}; if(!b.title||!b.content||!b.date) return res.status(400).json({error:'Title, date and information are required.'});
  const authority={official_fju:100,course_material:90,lecture_notes:80,student_whatsapp:35,other:40}[b.source_type]||40;
  const item={id:'k-'+Date.now(),title:String(b.title).slice(0,180),source_type:b.source_type||'other',authority,date:b.date,valid_until:b.valid_until||null,audience:b.audience||'students',keywords:Array.isArray(b.keywords)?b.keywords.slice(0,30):[],content:String(b.content).slice(0,8000)};
  const items=loadKB(); items.push(item); saveKB(items); res.json({ok:true,item});
});

// Draft (but do NOT save) candidate knowledge entries from a raw pasted WhatsApp
// chat export. Admin reviews/edits the drafts client-side and publishes the ones
// they want via the existing POST /api/athena/knowledge above. Names, phone
// numbers and other identifying details are instructed to be stripped by the
// model; nothing here is written to the knowledge base automatically.
app.post('/api/athena/draft-from-chat', admin, async (req,res)=>{
  try{
    const raw = String(req.body?.text||'').slice(0, 60000);
    if(!raw.trim()) return res.status(400).json({error:'Paste or upload some text first.'});
    const prompt = `You are helping an FJU course admin turn pasted text (a WhatsApp chat export, a quick note, or an announcement) into a small number of short, useful knowledge base entries for other students.

Rules:
- Only include information that is genuinely useful for other students (deadlines, platform issues, clarifications, tips, announcements). Ignore greetings, small talk, and anything not useful.
- Never include any student's name, phone number, or other personal identifying detail in the output. Refer to people generically ("a student", "several students") if needed.
- Merge duplicate or related points about the same topic into one entry.
- For each entry produce: title (short), date (YYYY-MM-DD, your best guess from the text, or the most recent relevant date mentioned), keywords (3-8 short lowercase terms), content (2-4 plain-English sentences, no names or numbers).
- Return STRICT JSON only: an array of objects with exactly these fields: title, date, keywords (array of strings), content. No other text, no markdown code fences.
- If there is nothing useful in the text, return [].

PASTED TEXT:
${raw}`;
    const response = await client.responses.create({ model: MODEL, input: prompt });
    let text = (response.output_text || '').trim();
    text = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    let items;
    try { items = JSON.parse(text); } catch (e) { return res.status(502).json({ error: 'Could not draft entries from that text. Try a shorter excerpt.' }); }
    if (!Array.isArray(items)) items = [];
    items = items.slice(0, 25).map(it => ({
      title: String(it.title || '').slice(0, 180),
      date: String(it.date || '').slice(0, 10),
      source_type: 'student_whatsapp',
      keywords: Array.isArray(it.keywords) ? it.keywords.slice(0, 10).map(k => String(k).slice(0, 40)) : [],
      content: String(it.content || '').slice(0, 1200)
    })).filter(it => it.title && it.content);
    res.json({ items });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not draft entries right now.' }); }
});

const port=process.env.PORT||3000; app.listen(port,()=>console.log(`FJU Athena listening on ${port}`));
