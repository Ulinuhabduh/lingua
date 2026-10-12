const words = [
  {word:'curious', phonetic:'/ˈkjʊəriəs/', meaning:'penasaran', category:'Sehari-hari', example:'The little girl is curious about everything.', translation:'Anak perempuan itu penasaran tentang segala hal.'},
  {word:'kind', phonetic:'/kaɪnd/', meaning:'baik hati', category:'Perasaan', example:'My neighbor is a very kind person.', translation:'Tetanggaku adalah orang yang sangat baik hati.'},
  {word:'routine', phonetic:'/ruːˈtiːn/', meaning:'rutinitas', category:'Aktivitas', example:'I have a simple morning routine.', translation:'Saya punya rutinitas pagi yang sederhana.'},
  {word:'thirsty', phonetic:'/ˈθɜːrsti/', meaning:'haus', category:'Sehari-hari', example:'Would you like some water? I am thirsty.', translation:'Mau minum air? Saya haus.'},
  {word:'proud', phonetic:'/praʊd/', meaning:'bangga', category:'Perasaan', example:'I am proud of my little sister.', translation:'Saya bangga pada adik perempuan saya.'},
  {word:'practice', phonetic:'/ˈpræktɪs/', meaning:'berlatih', category:'Aktivitas', example:'We practice English every afternoon.', translation:'Kami berlatih bahasa Inggris setiap sore.'},
  {word:'friendly', phonetic:'/ˈfrendli/', meaning:'ramah', category:'Perasaan', example:'The new teacher is friendly and helpful.', translation:'Guru baru itu ramah dan suka membantu.'},
  {word:'borrow', phonetic:'/ˈbɑːroʊ/', meaning:'meminjam', category:'Sehari-hari', example:'Can I borrow your pencil, please?', translation:'Bolehkah saya meminjam pensilmu?'},
  {word:'prepare', phonetic:'/prɪˈper/', meaning:'menyiapkan', category:'Aktivitas', example:'I prepare my bag before school.', translation:'Saya menyiapkan tas sebelum sekolah.'},
  {word:'excited', phonetic:'/ɪkˈsaɪtɪd/', meaning:'bersemangat', category:'Perasaan', example:'They are excited about the school trip.', translation:'Mereka bersemangat tentang perjalanan sekolah.'},
  {word:'quiet', phonetic:'/ˈkwaɪət/', meaning:'tenang', category:'Sehari-hari', example:'I like reading in a quiet place.', translation:'Saya suka membaca di tempat yang tenang.'},
  {word:'improve', phonetic:'/ɪmˈpruːv/', meaning:'meningkatkan', category:'Aktivitas', example:'A little practice can improve your English.', translation:'Sedikit latihan dapat meningkatkan bahasa Inggrismu.'}
];
const defaultPrompts = [
  {title:'Introduce yourself', question:'What is your name? Where are you from? What do you like to do?'},
  {title:'Your favorite food', question:'What is your favorite food? When do you usually eat it? Why do you like it?'},
  {title:'A perfect weekend', question:'What do you like to do on the weekend? Who do you spend time with?'},
  {title:'Your daily routine', question:'What time do you wake up? What do you do in the morning?'},
  {title:'A place you love', question:'Describe a place you love. What can you see and do there?'}
];
let prompts = [...defaultPrompts];

const defaultState = {xp:0,learned:[],minutes:0,streak:0,longest:0,lastStudy:null,days:{},lastVisit:null};
let state;
try { state={...defaultState,...JSON.parse(localStorage.getItem('lingua-progress')||'{}')}; }
catch { state={...defaultState}; }
if (!state.days) state.days={};
let visibleWords=[...words];
let currentWord=0;
let toastTimer;
let recognition=null;
let isRecording=false;
let audioTimer=null;
let audioElapsed=0;
let audioSpeed=1;
let dailyLessonData=null;
let realtimeConnection=null;
let realtimeChannel=null;
let microphoneStream=null;
let partnerAudio=null;
let conversationTurns=[];
let assistantTranscriptNode=null;
let conversationTimer=null;

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
const dateKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const todayKey=()=>dateKey(new Date());
function saveState(){localStorage.setItem('lingua-progress',JSON.stringify(state));renderProgress();}
function toast(message){const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),2300);}
function addStudy(minutes,xp=0){const today=todayKey();state.minutes=(state.minutes||0)+minutes;state.xp=(state.xp||0)+xp;state.days[today]=(state.days[today]||0)+minutes;if(state.lastStudy!==today){const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);state.streak=state.lastStudy===dateKey(yesterday)?(state.streak||0)+1:1;state.lastStudy=today;}state.longest=Math.max(state.longest||0,state.streak||0);saveState();}
function renderProgress(){
  $('#xpCount').textContent=state.xp||0;$('#progressXpTotal').textContent=`${state.xp||0} XP`;$('#progressXP').textContent=`${state.xp||0} XP`;
  $('#learnedCount').textContent=(state.learned||[]).length;$('#progressWords').textContent=`${(state.learned||[]).length} kata`;
  $('#streakCount').textContent=state.streak||0;$('#longestStreak').textContent=`${state.longest||0} hari`;
  const level=Math.min(6,Math.floor((state.xp||0)/100)+1);const names=['Pemula','Penjelajah','Perangkai Kata','Pencerita','Komunikator','Lancar'];$('#levelLabel').textContent=names[level-1];$('#progressLevel').textContent=names[level-1];
  const levelXP=(state.xp||0)%100;$('#levelProgressBar').style.width=`${levelXP}%`;
  $('#goalPercent').textContent=`${Math.min(100,Math.round(((state.days[todayKey()]||0)/20)*100))}%`;
  const goalPct=Math.min(100,Math.round(((state.days[todayKey()]||0)/20)*100));$('#goalRing').style.background=`conic-gradient(var(--purple) ${goalPct*3.6}deg,#eeedf5 0deg)`;$('#dailyCount').textContent=state.days[todayKey()]||0;
  const now=new Date();const dateLabel=new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(now).toUpperCase();$('#dateLabel').textContent=dateLabel;
  const day=now.getDay();const mondayOffset=(day+6)%7;const weekStart=new Date(now);weekStart.setDate(now.getDate()-mondayOffset);let weekMinutes=0;const weekData=[];
  for(let i=0;i<7;i++){const date=new Date(weekStart);date.setDate(weekStart.getDate()+i);const key=dateKey(date);const val=state.days[key]||0;weekMinutes+=val;weekData.push({date,key,val,today:key===todayKey()});}
  $('#weekMinutes').textContent=weekMinutes;
  $('#activityChart').innerHTML=weekData.map(d=>`<div class="activity-bar ${d.today?'today':''} ${d.val?'done':''}" data-minutes="${d.val}" style="--bar-height:${Math.max(10,Math.min(100,d.val*4))}%"><i></i></div>`).join('');
  $('#progressWeek').innerHTML=weekData.map((d,i)=>`<div class="week-day ${d.today?'today':''} ${d.val?'done':''}"><span>${['Sen','Sel','Rab','Kam','Jum','Sab','Min'][i]}</span><div><i style="height:${Math.max(7,Math.min(100,d.val*4))}%"></i></div></div>`).join('');
  $('#wordMilestone').classList.toggle('unlocked',(state.learned||[]).length>=10);$('#wordMilestone').querySelector('i').textContent=(state.learned||[]).length>=10?'✓':'🔒';
  $('#streakMilestone').classList.toggle('unlocked',(state.longest||0)>=3);$('#streakMilestone').querySelector('i').textContent=(state.longest||0)>=3?'✓':'🔒';
}

function setView(name){const target=$(`#view-${name}`);if(!target)return;$$('.view').forEach(v=>v.classList.toggle('active',v===target));$$('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view===name));$('#pageTitle').textContent=target.dataset.title||'Beranda';$('#sidebar').classList.remove('open');window.scrollTo({top:0,behavior:'smooth'});}
$$('.nav-link').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
$$('[data-go]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.go)));
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
document.addEventListener('click',event=>{if(window.innerWidth<=760&&!$('#sidebar').contains(event.target)&&!$('#mobileMenu').contains(event.target))$('#sidebar').classList.remove('open');});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){event.preventDefault();$('#globalSearch').focus();}if(event.key==='Escape'){$('#globalSearch').blur();$('#sidebar').classList.remove('open');}});

function renderWord(){const word=visibleWords[currentWord];if(!word)return;$('#wordCategory').textContent=word.category.toUpperCase();$('#wordFront').textContent=word.word;$('#wordPhonetic').textContent=word.phonetic;$('#wordMeaning').textContent=word.meaning;$('#wordExample').textContent=`“${word.example}”`;$('#wordTranslation').textContent=word.translation;$('#deckCount').textContent=`${String(currentWord+1).padStart(2,'0')} / ${visibleWords.length} kata`;$('#flashcard').classList.remove('flipped');}
function nextWord(step){currentWord=(currentWord+step+visibleWords.length)%visibleWords.length;renderWord();}
$('#flashcard').addEventListener('click',()=>$('#flashcard').classList.toggle('flipped'));
$('#flashcard').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('#flashcard').classList.toggle('flipped');}});
$('#prevCard').addEventListener('click',()=>nextWord(-1));$('#nextCard').addEventListener('click',()=>nextWord(1));
$('#vocabFilters').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(!button)return;$$('.filter-chip').forEach(chip=>chip.classList.toggle('selected',chip===button));visibleWords=button.dataset.category==='Semua'?[...words]:words.filter(word=>word.category===button.dataset.category);currentWord=0;renderWord();});
function speak(text,lang='en-US'){if(!('speechSynthesis'in window)){toast('Pengucapan suara tidak tersedia di browser ini.');return;}speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang=lang;utterance.rate=.88;speechSynthesis.speak(utterance);}
$('#speakWord').addEventListener('click',event=>{event.stopPropagation();speak(visibleWords[currentWord].word);});
$('#knowWord').addEventListener('click',()=>{const word=visibleWords[currentWord];if(!(state.learned||[]).includes(word.word)){state.learned.push(word.word);addStudy(2,10);toast(`“${word.word}” ditambahkan ke kosakatamu · +10 XP`);}else{addStudy(1,2);toast('Kata ini sudah ada di daftar belajarmu · +2 XP');}nextWord(1);});
$('#reviewWord').addEventListener('click',()=>{addStudy(1,2);nextWord(1);toast('Bagus, mengulang membantu kata lebih mudah diingat · +2 XP');});

function setupQuiz(containerSelector,correct,feedbackSelector,successText){const container=$(containerSelector);container.dataset.correctAnswer=correct;container.dataset.successText=successText;container.addEventListener('click',event=>{const button=event.target.closest('button[data-answer]');if(!button||button.disabled)return;const activeAnswer=container.dataset.correctAnswer;const buttons=$$('button[data-answer]',container);buttons.forEach(b=>{b.disabled=true;b.classList.toggle('correct',b.dataset.answer===activeAnswer);if(b===button&&b.dataset.answer!==activeAnswer)b.classList.add('incorrect');});const good=button.dataset.answer===activeAnswer;$(feedbackSelector).textContent=good?(container.dataset.successText||successText):(container.dataset.wrongText||'Belum tepat. Coba perhatikan pola kalimatnya, lalu lanjutkan belajar.');$(feedbackSelector).style.color=good?'#4d9a75':'#c17c6f';if(good)addStudy(3,15);else addStudy(1,2);});}
setupQuiz('[data-quiz="grammar"]','are','#grammarFeedback','Benar! “My friends” adalah jamak, jadi kita menggunakan “are”. +15 XP');
setupQuiz('[data-quiz="reading"]','read','#readingFeedback','Tepat! Maya membaca cerita sebelum tidur. +15 XP');
setupQuiz('[data-quiz="listening"]','latte','#listeningFeedback','Betul! Pelanggan memesan small latte. +15 XP');

function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function renderDailyQuiz(rootSelector,question,options,answer,explanation,sentence=null){
  const root=$(rootSelector);if(!root)return;
  const questionNode=$('.quiz-question',root);if(questionNode)questionNode.textContent=question;
  const sentenceNode=$('.sentence-prompt',root);if(sentenceNode&&sentence)sentenceNode.textContent=sentence;
  const optionsNode=$('.answer-options',root);optionsNode.innerHTML=options.map(option=>`<button type="button" data-answer="${escapeHTML(option)}">${escapeHTML(option)}</button>`).join('');
  root.dataset.correctAnswer=answer;root.dataset.successText=`Benar! ${explanation} · +15 XP`;root.dataset.wrongText=`Belum tepat. ${explanation}`;
  const feedback=$('.quiz-feedback',root);if(feedback)feedback.textContent='';
}
function updateSpeakingPhrases(phrases){
  const card=$('.phrase-card');if(!card)return;
  card.innerHTML=`<div class="section-kicker">KALIMAT BANTU HARI INI</div><h3>Mulai dengan ini</h3>${phrases.slice(0,4).map(phrase=>`<button class="phrase" type="button" data-phrase="${escapeHTML(phrase)}">“${escapeHTML(phrase)}” <span>↗</span></button>`).join('')}`;
}
function applyDailyLesson(result){
  const lesson=result.lesson;dailyLessonData=result;
  words.splice(0,words.length,...lesson.vocabulary.map(item=>({word:item.word,phonetic:item.phonetic,meaning:item.meaningId,category:item.category,example:item.exampleEn,translation:item.exampleId})));
  visibleWords=[...words];currentWord=0;renderWord();
  $$('.filter-chip').forEach(chip=>chip.classList.toggle('selected',chip.dataset.category==='Semua'));
  const vocabBanner=$('.vocab-banner');$('h2',vocabBanner).textContent=`Kata hari ini: ${result.theme}`;$('p',vocabBanner).textContent='Balik kartu, dengarkan pengucapan, lalu simpan kata yang ingin kamu ingat.';
  $('.card-vocab .card-meta span').textContent=`${lesson.vocabulary.length} kata hari ini`;
  const grammar=lesson.grammar;$('.grammar-banner h2').textContent=grammar.title;$('.grammar-banner>div>p').textContent=grammar.summaryId;
  $('.grammar-cards').innerHTML=grammar.examples.map((example,index)=>`<article class="grammar-card"><span class="grammar-card-num">${String(index+1).padStart(2,'0')}</span><div><span class="grammar-label">${escapeHTML(example.label.toUpperCase())}</span><h3>${escapeHTML(grammar.title)}</h3><p>${escapeHTML(grammar.explanationId)}</p><div class="grammar-example"><span>${escapeHTML(example.english)}</span><small>${escapeHTML(example.indonesian)}</small></div></div><span class="grammar-card-icon ${['icon-lavender','icon-peach','icon-mint'][index%3]}">${escapeHTML(example.label.slice(0,1))}</span></article>`).join('');
  renderDailyQuiz('#grammarQuiz',grammar.quiz.question,grammar.quiz.options,grammar.quiz.answer,grammar.quiz.explanationId,grammar.quiz.sentence);
  const reading=lesson.reading;$('.reading-body h2').textContent=reading.title;$('.reading-lead').textContent=reading.introId;$('.cover-label').textContent=reading.title.toUpperCase();$('.story-text').innerHTML=reading.paragraphs.map(paragraph=>`<p>${escapeHTML(paragraph)}</p>`).join('');
  renderDailyQuiz('.reading-quiz',reading.question,reading.options,reading.answer,reading.explanationId);
  const listening=lesson.listening;$('.listening-player h2').textContent=listening.title;$('.listening-player>p').textContent=listening.introId;
  $('#transcript').innerHTML=listening.dialogue.map(turn=>`<p><b>${escapeHTML(turn.speaker)}:</b> ${escapeHTML(turn.line)}</p>`).join('');
  const duration=Math.max(12,Math.ceil(listening.dialogue.map(turn=>turn.line).join(' ').split(/\s+/).length/2.5));$('.audio-times span:last-child').textContent=`${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')}`;
  renderDailyQuiz('.listening-quiz',listening.question,listening.options,listening.answer,listening.explanationId);
  prompts=[{title:lesson.speaking.topic,question:lesson.speaking.questions.join(' ')},...defaultPrompts.filter(prompt=>prompt.title!==lesson.speaking.topic)];promptIndex=0;setPrompt();updateSpeakingPhrases(lesson.speaking.phrases);
  $('.writing-prompt-card h2').textContent=lesson.writing.topic;$('.writing-prompt-card>p').textContent=lesson.writing.promptId;$('.prompt-helper').innerHTML=`<span>✦</span> Coba gunakan: ${lesson.writing.phraseHints.map(hint=>`<b>${escapeHTML(hint)}</b>`).join(' ')}`;$('.editor-helper').textContent='Tulisanmu dikirim ke OpenAI untuk mendapat masukan.';
  const heroTitle=$('.hero-copy h2');heroTitle.replaceChildren(document.createTextNode('Tema belajar hari ini'),document.createElement('br'),document.createTextNode(result.theme));
  $('.hero-copy>p').textContent='Enam latihan singkat yang saling terhubung, dibuat khusus untuk hari ini.';
  $('.hero-copy .hero-foot').textContent=`✓ Materi hari ini siap · ${result.level} · ${result.date}`;
  $('.continue-item[data-go="reading"] .continue-copy strong').textContent=reading.title;
  $('.continue-item[data-go="listening"] .continue-copy strong').textContent=listening.title;
  $('.daily-status-text').textContent=`Materi hari ini siap: ${result.theme}`;$('.daily-status').classList.add('ready');
}
function ensureDailyStatus(){
  if($('#dailyStatus'))return;
  const bar=document.createElement('div');bar.className='daily-status';bar.id='dailyStatus';bar.innerHTML='<span class="daily-status-dot"></span><span class="daily-status-text">Memuat materi hari ini…</span>';
  $('.welcome-row').insertAdjacentElement('afterend',bar);
}
async function loadDailyLesson(){
  ensureDailyStatus();const date=todayKey();const level=state.level||'beginner';const cacheKey=`lingua-daily:${date}:${level}`;
  $('.daily-status-text').textContent='Memuat enam materi hari ini…';$('.daily-status').classList.remove('ready','error');
  try{
    const cached=localStorage.getItem(cacheKey);
    if(cached){const result=JSON.parse(cached);applyDailyLesson(result);return;}
  }catch{}
  try{
    const response=await fetch(`/api/daily?date=${encodeURIComponent(date)}&level=${encodeURIComponent(level)}`);
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Materi harian gagal dimuat.');
    applyDailyLesson(result);try{localStorage.setItem(cacheKey,JSON.stringify(result));}catch{}
  }catch(error){$('.daily-status-text').textContent=error.message.includes('Failed to fetch')?'Hubungkan aplikasi ke server AI untuk memuat materi harian.':error.message;$('.daily-status').classList.add('error');}
}
function scheduleDailyRefresh(){const next=new Date();next.setHours(24,0,5,0);setTimeout(()=>{loadDailyLesson();scheduleDailyRefresh();},Math.max(1000,next-Date.now()));}

$$('[data-speak="story"]').forEach(button=>button.addEventListener('click',()=>{const text=dailyLessonData?.lesson.reading.paragraphs.join(' ')||'Hi! My name is Maya. I wake up at seven o’clock every morning. First, I brush my teeth and take a shower. Then, I have breakfast with my family. I usually eat toast and fruit. At eight o’clock, I walk to school with my friend, Ben. We talk about our favorite books on the way. After school, I do my homework and play with my cat. In the evening, I read a story before I go to bed. I love my daily routine!';speak(text);addStudy(2,5);}));

$('#transcriptToggle').addEventListener('click',()=>{const transcript=$('#transcript');transcript.classList.toggle('open');$('#transcriptToggle').innerHTML=transcript.classList.contains('open')?'Sembunyikan transkrip <span>⌃</span>':'Lihat transkrip <span>⌄</span>';});
function playListening(){if(audioTimer){clearInterval(audioTimer);audioTimer=null;$('#playListening').textContent='▶';speechSynthesis?.cancel();return;}audioElapsed=0;const lines=dailyLessonData?.lesson.listening.dialogue||[{speaker:'Barista',line:'Hi there! What can I get for you?'},{speaker:'Customer',line:'I’d like a small latte, please.'},{speaker:'Barista',line:'Sure! Would you like it hot or iced?'},{speaker:'Customer',line:'Hot, please. That’s all, thank you.'}];const text=lines.map(turn=>`${turn.speaker}: ${turn.line}`).join('. ');const estimatedDuration=Math.max(12,Math.ceil(text.split(/\s+/).length/2.5));const utterance=new SpeechSynthesisUtterance(text);utterance.lang='en-US';utterance.rate=audioSpeed;utterance.onend=()=>{clearInterval(audioTimer);audioTimer=null;audioElapsed=estimatedDuration;$('#audioProgress').style.width='100%';$('#audioCurrent').textContent=`${Math.floor(estimatedDuration/60)}:${String(estimatedDuration%60).padStart(2,'0')}`;$('#playListening').textContent='▶';addStudy(2,5);};utterance.onerror=()=>{clearInterval(audioTimer);audioTimer=null;$('#playListening').textContent='▶';};if(!('speechSynthesis'in window)){toast('Audio tidak tersedia di browser ini. Baca transkrip untuk melanjutkan.');return;}speechSynthesis.cancel();speechSynthesis.speak(utterance);$('#playListening').textContent='Ⅱ';audioTimer=setInterval(()=>{audioElapsed=Math.min(estimatedDuration,audioElapsed+1);$('#audioProgress').style.width=`${audioElapsed/estimatedDuration*100}%`;$('#audioCurrent').textContent=`${Math.floor(audioElapsed/60)}:${String(audioElapsed%60).padStart(2,'0')}`;if(audioElapsed>=estimatedDuration&&audioTimer){clearInterval(audioTimer);audioTimer=null;$('#playListening').textContent='▶';}},1000);}
$('#playListening').addEventListener('click',playListening);$('#audioSpeed').addEventListener('click',()=>{audioSpeed=audioSpeed===1?0.8:audioSpeed===0.8?1.2:1;$('#audioSpeed').textContent=`${audioSpeed}×`;});

let promptIndex=0;function setPrompt(){const p=prompts[promptIndex];$('#speakingPrompt').textContent=p.title;$('#speakingQuestion').textContent=p.question;}
$('#newPrompt').addEventListener('click',()=>{promptIndex=(promptIndex+1)%prompts.length;setPrompt();});
$('#view-speaking').addEventListener('click',event=>{const button=event.target.closest('.phrase');if(button){speak(button.dataset.phrase);toast(`Dengarkan pengucapan: ${button.dataset.phrase}`);}});

function initFreeConversation(){
  const panel=document.createElement('section');panel.className='free-talk-card';panel.id='freeTalkCard';
  panel.innerHTML='<div class="free-talk-header"><div><span class="section-kicker">SPEAKING BEBAS · PARTNER AI</span><h2>Ngobrol dalam bahasa Inggris</h2><p>Bicarakan apa saja. Partner AI akan merespons dengan suara dan membantu dengan koreksi ringan.</p></div><div class="free-talk-actions"><button class="button button-primary" id="freeTalkStart" type="button"><span>●</span> Mulai ngobrol</button><button class="button button-quiet" id="freeTalkStop" type="button" hidden>Berhenti & minta feedback</button></div></div><div class="free-talk-disclosure"><span>ⓘ</span> Suara partner dibuat AI. Audio mikrofon dikirim ke OpenAI selama sesi; transkrip dikirim untuk membuat feedback setelah sesi.</div><div class="free-talk-status" id="freeTalkStatus" aria-live="polite">Mulai sesi, lalu bicara santai dalam bahasa Inggris. Kamu bebas pindah topik kapan saja.</div><div class="conversation-log" id="conversationLog" aria-live="polite"><div class="conversation-empty">Percakapanmu akan muncul di sini setelah kamu mulai bicara.</div></div><div class="conversation-feedback" id="conversationFeedback" aria-live="polite"></div>';
  $('#view-speaking .view-heading').insertAdjacentElement('afterend',panel);
  $('#freeTalkStart').addEventListener('click',startFreeConversation);
  $('#freeTalkStop').addEventListener('click',stopFreeConversation);
}
function addConversationBubble(role,text){
  const log=$('#conversationLog');$('.conversation-empty',log)?.remove();
  const bubble=document.createElement('article');bubble.className=`conversation-turn ${role}`;
  const label=document.createElement('span');label.className='conversation-label';label.textContent=role==='learner'?'KAMU':'PARTNER AI';
  const content=document.createElement('p');content.textContent=text;bubble.append(label,content);log.append(bubble);log.scrollTop=log.scrollHeight;return content;
}
function handleRealtimeEvent(event){
  if(event.type==='input_audio_buffer.speech_started'){$('#freeTalkStatus').textContent='Sedang mendengarkan…';return;}
  if(event.type==='input_audio_buffer.speech_stopped'){$('#freeTalkStatus').textContent='Menyusun balasan…';return;}
  if(event.type==='conversation.item.input_audio_transcription.completed'){
    const text=event.transcript?.trim();if(text){conversationTurns.push({role:'user',text});addConversationBubble('learner',text);}return;
  }
  if(event.type==='response.output_audio_transcript.delta'){
    if(!assistantTranscriptNode)assistantTranscriptNode=addConversationBubble('partner','');assistantTranscriptNode.textContent+=event.delta||'';$('#conversationLog').scrollTop=$('#conversationLog').scrollHeight;return;
  }
  if(event.type==='response.output_audio_transcript.done'){
    const text=(event.transcript||assistantTranscriptNode?.textContent||'').trim();
    if(text){if(assistantTranscriptNode)assistantTranscriptNode.textContent=text;else addConversationBubble('partner',text);conversationTurns.push({role:'assistant',text});}
    assistantTranscriptNode=null;$('#freeTalkStatus').textContent='Terhubung · silakan lanjut bicara';return;
  }
  if(event.type==='error')$('#freeTalkStatus').textContent=event.error?.message||'Ada kendala dalam sesi suara.';
}
async function startFreeConversation(){
  if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection){toast('Browser ini belum mendukung sesi suara langsung.');return;}
  const start=$('#freeTalkStart'),stop=$('#freeTalkStop');start.disabled=true;$('#conversationFeedback').textContent='';$('#conversationLog').innerHTML='';conversationTurns=[];assistantTranscriptNode=null;
  $('#freeTalkStatus').textContent='Meminta izin mikrofon dan menghubungkan partner AI…';
  try{
    microphoneStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    realtimeConnection=new RTCPeerConnection();partnerAudio=document.createElement('audio');partnerAudio.autoplay=true;partnerAudio.playsInline=true;partnerAudio.hidden=true;document.body.append(partnerAudio);
    realtimeConnection.ontrack=event=>{partnerAudio.srcObject=event.streams[0];partnerAudio.play().catch(()=>{});};
    microphoneStream.getTracks().forEach(track=>realtimeConnection.addTrack(track,microphoneStream));
    realtimeChannel=realtimeConnection.createDataChannel('oai-events');
    realtimeChannel.onmessage=event=>{try{handleRealtimeEvent(JSON.parse(event.data));}catch{}};
    realtimeChannel.onopen=()=>{$('#freeTalkStatus').textContent='Terhubung · mulai bicara kapan saja';start.hidden=true;stop.hidden=false;start.disabled=false;};
    const offer=await realtimeConnection.createOffer();await realtimeConnection.setLocalDescription(offer);
    const response=await fetch('/api/realtime',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sdp:offer.sdp,topic:dailyLessonData?.lesson.speaking.topic||'',userId:getAnonymousId()})});
    if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||'Partner AI belum bisa dihubungi.');}
    const answer=await response.text();await realtimeConnection.setRemoteDescription({type:'answer',sdp:answer});
    realtimeConnection.onconnectionstatechange=()=>{if(realtimeConnection?.connectionState==='failed')$('#freeTalkStatus').textContent='Koneksi terputus. Periksa jaringan lalu coba lagi.';};
    start.hidden=true;stop.hidden=false;$('#freeTalkStatus').textContent='Terhubung · mulai bicara kapan saja';conversationTimer=setTimeout(()=>stopFreeConversation(),8*60*1000);
  }catch(error){await releaseConversationMedia();start.disabled=false;start.hidden=false;stop.hidden=true;$('#freeTalkStatus').textContent=error.message;toast(error.message);}
}
function getAnonymousId(){let id;try{id=localStorage.getItem('lingua-anonymous-id');if(!id){id=crypto.randomUUID();localStorage.setItem('lingua-anonymous-id',id);}}catch{id=`lingua-${Date.now()}`;}return id;}
async function releaseConversationMedia(){
  clearTimeout(conversationTimer);conversationTimer=null;
  if(realtimeChannel){try{realtimeChannel.close();}catch{}realtimeChannel=null;}
  if(realtimeConnection){try{realtimeConnection.close();}catch{}realtimeConnection=null;}
  if(microphoneStream){microphoneStream.getTracks().forEach(track=>track.stop());microphoneStream=null;}
  if(partnerAudio){partnerAudio.srcObject=null;partnerAudio.remove();partnerAudio=null;}
}
async function stopFreeConversation(){
  if(!realtimeConnection&&!microphoneStream)return;
  const stop=$('#freeTalkStop'),start=$('#freeTalkStart');stop.disabled=true;$('#freeTalkStatus').textContent='Sesi selesai · sedang menyiapkan feedback…';
  await releaseConversationMedia();stop.hidden=true;stop.disabled=false;start.hidden=false;start.disabled=false;
  if(!conversationTurns.some(turn=>turn.role==='user')){$('#freeTalkStatus').textContent='Sesi berakhir. Belum ada ucapan yang bisa dievaluasi.';return;}
  try{
    const response=await fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:dailyLessonData?.lesson.speaking.topic||'free conversation',turns:conversationTurns})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Feedback belum bisa dimuat.');
    const target=$('#conversationFeedback');target.innerHTML=`<div class="section-kicker">FEEDBACK LATIHANMU</div><h3>${escapeHTML(result.overall)}</h3><div class="feedback-columns"><div><strong>Yang sudah bagus</strong><ul>${result.strengths.map(item=>`<li>${escapeHTML(item)}</li>`).join('')}</ul></div><div><strong>Coba versi yang lebih natural</strong>${result.corrections.map(item=>`<p><span>“${escapeHTML(item.original)}”</span> → <b>“${escapeHTML(item.naturalVersion)}”</b><small>${escapeHTML(item.explanationId)}</small></p>`).join('')}</div></div><p class="pronunciation-note">${escapeHTML(result.pronunciationNote)}</p><p class="next-practice"><b>Latihan berikutnya:</b> ${escapeHTML(result.nextPractice)}</p>`;
    $('#freeTalkStatus').textContent='Feedback siap. Percakapan ini hanya disimpan di halaman sampai kamu menutupnya.';addStudy(5,20);
  }catch(error){$('#freeTalkStatus').textContent=error.message;toast(error.message);}
}
function stopRecording(){if(recognition){try{recognition.stop();}catch{}}isRecording=false;$('#recordButton').classList.remove('recording');$('#recordLabel').textContent='Tekan untuk mulai bicara';}
$('#recordButton').addEventListener('click',()=>{
  if(isRecording){stopRecording();return;}
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){$('#speechResult').classList.add('visible');$('#speechTranscript').textContent='Browser ini belum mendukung pengenalan suara. Kamu tetap bisa berlatih dengan mengucapkan jawabanmu sendiri.';$('#speechFeedback').textContent='Coba gunakan Chrome atau browser yang mendukung fitur speech recognition.';toast('Pengenalan suara belum tersedia di browser ini.');return;}
  recognition=new SpeechRecognition();recognition.lang='en-US';recognition.interimResults=true;recognition.continuous=true;let finalText='';recognition.onstart=()=>{isRecording=true;$('#recordButton').classList.add('recording');$('#recordLabel').textContent='Sedang mendengarkan... tekan untuk selesai';$('#speechResult').classList.add('visible');$('#speechTranscript').textContent='';$('#speechFeedback').textContent='';};recognition.onresult=event=>{let interim='';for(let i=event.resultIndex;i<event.results.length;i++){const text=event.results[i][0].transcript;if(event.results[i].isFinal)finalText+=text+' ';else interim+=text;}$('#speechTranscript').textContent=(finalText+interim).trim()||'...';};recognition.onerror=event=>{stopRecording();$('#speechFeedback').textContent=event.error==='not-allowed'?'Izin mikrofon belum diberikan. Aktifkan izin mikrofon di browser untuk mencoba lagi.':'Ada kendala saat mengenali suara. Coba bicara sekali lagi.';};recognition.onend=()=>{isRecording=false;$('#recordButton').classList.remove('recording');$('#recordLabel').textContent='Tekan untuk mulai bicara';const text=$('#speechTranscript').textContent.trim();if(text&&text!=='...'){addStudy(2,10);const wc=text.split(/\s+/).length;$('#speechFeedback').textContent=`Kamu sudah menyampaikan ${wc} kata. Bagus, terus berlatih agar makin percaya diri! +10 XP`;}};try{recognition.start();}catch{toast('Coba lagi dalam beberapa detik.');}
});

const writingInput=$('#writingInput');writingInput.addEventListener('input',()=>{$('#wordCount').textContent=writingInput.value.trim()?writingInput.value.trim().split(/\s+/).length:0;});
$('#clearWriting').addEventListener('click',()=>{writingInput.value='';$('#wordCount').textContent='0';$('#writingFeedback').textContent='';});
$('#reviewWriting').addEventListener('click',async()=>{const text=writingInput.value.trim();const feedback=$('#writingFeedback');const count=text?text.split(/\s+/).length:0;if(count<5){feedback.style.color='#c17c6f';feedback.textContent='Tulis setidaknya 5 kata untuk mendapatkan masukan.';return;}const button=$('#reviewWriting');button.disabled=true;feedback.style.color='#858498';feedback.textContent='AI sedang membaca tulisanmu…';try{const response=await fetch('/api/writing-feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,topic:dailyLessonData?.lesson.writing.topic||'English writing'})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Feedback belum tersedia.');feedback.style.color='#4d9a75';feedback.innerHTML=`<strong>${escapeHTML(result.overall)}</strong><p><b>Versi lebih natural:</b> ${escapeHTML(result.correctedVersion)}</p>${result.corrections.map(item=>`<p>“${escapeHTML(item.original)}” → <b>“${escapeHTML(item.suggested)}”</b><br><small>${escapeHTML(item.explanationId)}</small></p>`).join('')}<p><b>Latihan berikutnya:</b> ${escapeHTML(result.nextTip)}</p>`;addStudy(4,15);}catch(error){feedback.style.color='#c17c6f';feedback.textContent=error.message;}finally{button.disabled=false;}});

const search=$('#globalSearch');search.addEventListener('input',()=>{const value=search.value.trim().toLowerCase();if(!value)return;const map={vocabulary:['word','kosakata','kata','vocabulary'],grammar:['grammar','tata bahasa','kalimat'],reading:['reading','membaca','cerita'],listening:['listening','mendengarkan','audio'],speaking:['speaking','berbicara'],writing:['writing','menulis'],progress:['progres','progress','xp']};for(const [view,terms] of Object.entries(map)){if(terms.some(term=>term.includes(value)||value.includes(term))){setView(view);return;}}});
search.addEventListener('keydown',event=>{if(event.key==='Enter'&&search.value.trim()){const value=search.value.trim().toLowerCase();const match=words.find(word=>word.word.includes(value)||word.meaning.includes(value));if(match){visibleWords=[match];currentWord=0;$$('.filter-chip').forEach(chip=>chip.classList.remove('selected'));setView('vocabulary');renderWord();}else toast('Materi belum ditemukan. Coba kata lain.');}});
$('#profileButton').addEventListener('click',()=>toast('Halo, Alexandra! Selamat datang kembali.'));
$('#activityRange').addEventListener('click',()=>toast('Grafik menampilkan aktivitas minggu ini.'));
renderProgress();renderWord();setPrompt();
initFreeConversation();$('.editor-helper').textContent='Saat kamu meminta feedback, tulisanmu dikirim ke OpenAI.';loadDailyLesson();scheduleDailyRefresh();

let deferredInstallPrompt=null;
const installButton=$('#installApp');
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
function syncInstallButton(){installButton.classList.toggle('installed',isStandalone());installButton.disabled=isStandalone();installButton.setAttribute('aria-label',isStandalone()?'Lingua sudah terpasang':'Pasang Lingua di perangkat ini');}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;syncInstallButton();});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;syncInstallButton();toast('Lingua berhasil dipasang di perangkatmu.');});
installButton.addEventListener('click',async()=>{
  if(isStandalone()){toast('Lingua sudah terpasang di perangkat ini.');return;}
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();const choice=await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;if(choice.outcome==='accepted')toast('Lingua sedang dipasang.');return;}
  const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  toast(isIOS?'Untuk memasang, ketuk Bagikan lalu “Tambahkan ke Layar Utama”.':'Buka menu browser, lalu pilih “Install app” atau “Tambahkan ke layar utama”.');
});
syncInstallButton();
if('serviceWorker'in navigator&&/^https?:$/.test(location.protocol)){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}
