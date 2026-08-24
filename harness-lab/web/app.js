const $ = id => document.getElementById(id)
const state = { sessionId:'', events:[], lastSeq:-1, stream:null, pending:null, attachments:[] }
$('token').value = sessionStorage.getItem('dsh-token') || ''

async function rpc(method, params, id=crypto.randomUUID()) {
  const response = await fetch('/rpc', { method:'POST', headers:{ authorization:`Bearer ${$('token').value}`, 'content-type':'application/json' }, body:JSON.stringify({jsonrpc:'2.0',id,method,params}) })
  const body = await response.json()
  if (body.error) throw Object.assign(new Error(body.error.message), { code:body.error.code, status:response.status })
  return body.result
}
function surfaceEvents() {
  const surface=[]
  for (const event of state.events) {
    const implicit = event.type==='user/message' || (event.type==='assistant/message' && event.data.message.content.length) || event.type==='tool/result'
    if (!event.surfaceOp && !implicit) continue
    if (!event.surfaceOp || event.surfaceOp==='append') { surface.push(event); continue }
    const start=surface.findIndex(item=>item.seq===event.surfaceOp.start), end=surface.findIndex(item=>item.seq===event.surfaceOp.end)
    if(start>=0&&end>=start) surface.splice(start,end-start+1,event)
  }
  return surface
}
function messageOf(event) { return event.type==='user/message'?event.data:event.type==='assistant/message'?event.data.message:event.type==='tool/result'?event.data.message:null }
function textOf(message) { return message.content.map(block=>block.type==='text'||block.type==='reasoning'?block.text:block.type==='tool-call'?`[tool call: ${block.name}]`:block.type==='tool-result'?`[tool result]\n${textOf({content:block.content})}`:block.type==='image'?`[image: ${block.attachment.attachmentId}]`:'').join('') }
function render() {
  $('seq').textContent=String(state.lastSeq)
  const running=state.events.findLast?.(e=>e.type==='turn/start'||e.type==='turn/end')?.type==='turn/start'
  $('running').textContent=running?'是':'否'
  let input=0,output=0; const samples=new Map()
  for(const event of state.events){let usage,turn,step;if(event.type==='assistant/chunk'&&event.data.chunk.type==='usage'){({turn,step}=event.data);usage=event.data.chunk.usage}else if(event.type==='assistant/message'&&event.data.usage){({turn,step,usage}=event.data)}if(usage)samples.set(`${turn}:${step}`,usage)}
  for(const usage of samples.values()){input+=usage.inputTokens+(usage.cacheReadTokens||0)+(usage.cacheWriteTokens||0);output+=usage.outputTokens}
  $('inputTokens').textContent=String(input);$('outputTokens').textContent=String(output)
  $('messages').replaceChildren(...surfaceEvents().map(event=>{const message=messageOf(event),node=document.createElement('article');node.className=`message ${message?.source?.kind==='tool'?'tool':message?.role||''}`;node.textContent=message?textOf(message):'';return node}))
  $('events').replaceChildren(...state.events.slice(-80).map(event=>{const li=document.createElement('li');li.textContent=`${event.seq} ${event.type}`;return li}))
  const decisions=new Set(state.events.filter(e=>e.type==='approval/decided').map(e=>e.data.id)),asked=state.events.filter(e=>e.type==='approval/asked'&&!decisions.has(e.data.id))
  $('approvals').replaceChildren(...asked.map(event=>{const box=document.createElement('div');box.textContent=`${event.data.toolName}: ${event.data.reason||''} `;for(const [label,outcome] of [['允许一次','allowed-once'],['拒绝','rejected']]){const button=document.createElement('button');button.textContent=label;button.onclick=()=>rpc('interaction.answer',{sessionId:state.sessionId,id:event.data.id,outcome}).catch(error=>notice(error.message));box.append(button)}return box}))
}
function apply(event){if(event.seq<=state.lastSeq)return;if(event.seq!==state.lastSeq+1)throw new Error(`事件序号缺口：期望 ${state.lastSeq+1}，收到 ${event.seq}`);state.events.push(event);state.lastSeq=event.seq;render()}
async function snapshot(){const value=await rpc('session.snapshot',{sessionId:state.sessionId});state.events=[];state.lastSeq=-1;for(const event of value.events)apply(event)}
async function stream() {
  let delay=100
  while(state.stream&&!state.stream.signal.aborted){try{
    setConnection('connecting');await snapshot()
    const response=await fetch(`/events?sessionId=${encodeURIComponent(state.sessionId)}&after=${state.lastSeq}`,{headers:{authorization:`Bearer ${$('token').value}`},signal:state.stream.signal})
    if(!response.ok||!response.body)throw new Error(`事件流 HTTP 状态码：${response.status}`)
    setConnection('connected');delay=100;const reader=response.body.getReader(),decoder=new TextDecoder();let buffer=''
    while(true){const chunk=await reader.read();if(chunk.done)throw new Error('事件流已经结束');buffer+=decoder.decode(chunk.value,{stream:true}).replaceAll('\r\n','\n');let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(data)apply(JSON.parse(data))}}
  }catch(error){if(state.stream?.signal.aborted)return;setConnection('reconnecting');notice(error.message);await new Promise(resolve=>setTimeout(resolve,delay));delay=Math.min(delay*2,3000)}}
}
function setConnection(value){$('connection').dataset.state=value;$('connection').textContent=value==='connected'?'已连接':value==='reconnecting'?'重连中':'连接中'}
function notice(text=''){$('notice').textContent=text}
async function open(mode){try{sessionStorage.setItem('dsh-token',$('token').value);state.stream?.abort();state.sessionId=$('session').value.trim();if(!state.sessionId)throw new Error('会话 ID 不能为空');await rpc(`session.${mode}`,{sessionId:state.sessionId});state.stream=new AbortController();void stream();notice('')}catch(error){notice(`${error.code||'错误'}：${error.message}`)}}
$('create').onclick=()=>open('create');$('resume').onclick=()=>open('resume')
$('composer').onsubmit=async event=>{event.preventDefault();const text=$('prompt').value.trim();if((!text&&!state.attachments.length)||!state.sessionId)return;const pending=state.pending?.text===text?state.pending:{id:crypto.randomUUID(),text,attachments:[...state.attachments]};state.pending=pending;$('send').disabled=true;$('retry').hidden=true;notice('命令执行中…');try{await rpc('session.send',{sessionId:state.sessionId,...(text?{text}:{}),attachments:pending.attachments},pending.id);$('prompt').value='';state.attachments=[];$('attachmentList').textContent='';state.pending=null;notice('')}catch(error){notice(`${error.code||'NETWORK'}: ${error.message}`);$('retry').hidden=false}finally{$('send').disabled=false}}
$('retry').onclick=()=>{if(!state.pending)return;$('prompt').value=state.pending.text;$('composer').requestSubmit()}
$('cancel').onclick=async()=>{try{await rpc('session.cancel',{sessionId:state.sessionId,reason:'web user cancelled'});notice('已请求取消')}catch(error){notice(error.message)}}
$('prompt').onkeydown=event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter')$('composer').requestSubmit()}
$('attachments').onchange=async event=>{try{for(const file of event.target.files){const response=await fetch('/attachments',{method:'POST',headers:{authorization:`Bearer ${$('token').value}`,'content-type':file.type,'x-file-name':encodeURIComponent(file.name)},body:file});if(!response.ok)throw new Error((await response.json()).error?.message||`上传失败，状态码 ${response.status}`);state.attachments.push(await response.json())}$('attachmentList').textContent=state.attachments.map(ref=>`${ref.name||ref.attachmentId}（${ref.bytes} 字节）`).join('，')}catch(error){notice(error.message)}finally{event.target.value=''}}
