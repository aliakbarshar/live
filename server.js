const { createClient } = require('@supabase/supabase-js');
const { spawn, exec } = require('child_process');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://meywyyvqmrnpbzrzzhvm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY || '');

let ffmpegProcess = null;
let autoSwitchTimer = null; // ۵ سيڪنڊن اڳ وارو ٽائيمر
let lastRestartTrigger = null;
let currentConfig = null;
let isBusySwitching = false;

const FONT_PATH = path.join(__dirname, 'sindhi.ttf');

console.log("🚀 Live Studio Engine Started with 5-Second Early Auto-Switch Logic & Safe Crash Fix...");

function sanitizeText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:');
}

// وڊيو جي ڪل ڊگهائي (Duration) سيڪنڊن ۾ حاصل ڪرڻ
function getVideoDuration(url) {
  return new Promise((resolve) => {
    exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${url}"`, (error, stdout) => {
      if (error || !stdout) {
        resolve(null);
      } else {
        const duration = parseFloat(stdout.trim());
        resolve(isNaN(duration) ? null : duration);
      }
    });
  });
}

// ٽريڪ تبديل ڪرڻ وارو آٽو مينجرمينٽ
async function handleNextTrackAuto() {
  if (isBusySwitching) return;
  isBusySwitching = true;

  try {
    const { data: config, error } = await supabase.from('stream_config').select('*').eq('id', 1).single();
    if (error || !config || !config.is_live || !config.playlist || config.playlist.length === 0) {
      isBusySwitching = false;
      return;
    }

    const playlist = config.playlist;
    const total = playlist.length;
    let currentIdx = Number(config.current_track_index || 0);
    
    // ايندڙ ٽريڪ جي چونڊ
    let nextIdx = (currentIdx + 1) % total;
    let upcomingIdx = (nextIdx + 1) % total;

    const autoNextText = `Track ${upcomingIdx + 1} of ${total}`;
    const newTrigger = Date.now();
    lastRestartTrigger = newTrigger;

    console.log(`⏱️ [5-Sec Early Switch Triggered]: Index ${currentIdx} ➔ Index ${nextIdx}`);

    // DB ۾ اپڊيٽ
    await supabase.from('stream_config').update({
      current_track_index: nextIdx,
      next_track: autoNextText,
      restart_trigger: newTrigger
    }).eq('id', 1);

    config.current_track_index = nextIdx;
    config.next_track = autoNextText;
    config.restart_trigger = newTrigger;
    currentConfig = config;

    // نئون ٽريڪ چالو ڪريو
    startBroadcaster(config);
  } catch (err) {
    console.error("Auto Switch Error:", err);
  } finally {
    setTimeout(() => { isBusySwitching = false; }, 3000);
  }
}

async function checkDatabaseState() {
  if (isBusySwitching) return;

  try {
    const { data: config, error } = await supabase.from('stream_config').select('*').eq('id', 1).single();
    if (error || !config) return;

    currentConfig = config;

    // مينوئل يا ٻاهران مٽجڻ وارو سگنل
    if (config.restart_trigger && config.restart_trigger !== lastRestartTrigger) {
      console.log("🔄 Manual Switch Requested!");
      lastRestartTrigger = config.restart_trigger;
      startBroadcaster(config);
      return;
    }

    if (!config.is_live && ffmpegProcess) {
      console.log("⏹️ Stream Signal OFF.");
      stopBroadcaster();
    } else if (config.is_live && !ffmpegProcess && !isBusySwitching) {
      console.log("▶️ Stream Signal ON.");
      if (config.restart_trigger) lastRestartTrigger = config.restart_trigger;
      startBroadcaster(config);
    }
  } catch (err) {
    console.error("Loop Check Error:", err);
  }
}

async function startBroadcaster(config) {
  stopBroadcaster();

  const playlist = (config.playlist && config.playlist.length > 0) 
    ? config.playlist 
    : [{ url: 'https://ia600404.us.archive.org/25/items/mran_20260927_202609/mran.mp4' }];

  let trackIndex = Number(config.current_track_index || 0);
  if (trackIndex >= playlist.length) trackIndex = 0;

  const activeVideoUrl = playlist[trackIndex].url;

  let fbKey = config.fb_key ? config.fb_key.trim() : '';
  let ytKey = config.yt_key ? config.yt_key.trim() : '';

  if (!fbKey && !ytKey) return;

  let fbTarget = fbKey ? (fbKey.startsWith('rtmp') ? fbKey : `rtmps://live-api-s.facebook.com:443/rtmp/${fbKey}`) : '';
  let ytTarget = ytKey ? (ytKey.startsWith('rtmp') ? ytKey : `rtmp://a.rtmp.youtube.com/live2/${ytKey}`) : '';

  const program = sanitizeText(config.program_name || '');
  const nextTrk = sanitizeText(config.next_track || '');
  const ticker = sanitizeText(config.ticker_text || '');
  const logoUrl = (config.logo_url && config.logo_url.trim() !== '') ? config.logo_url.trim() : 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/React-icon.svg/1200px-React-icon.svg.png';
  
  const logoSize = config.logo_size || '120';
  const pos = config.logo_position || 'top-right';

  let overlayPos = 'main_w-overlay_w-30:30';
  if (pos === 'top-left') overlayPos = '30:30';
  else if (pos === 'bottom-right') overlayPos = 'main_w-overlay_w-30:main_h-overlay_h-70';
  else if (pos === 'bottom-left') overlayPos = '30:main_h-overlay_h-70';

  let videoFilter = `[1:v]scale=${logoSize}:-1[logo];[0:v][logo]overlay=${overlayPos}[v1]`;
  
  const fontOpt = fs.existsSync(FONT_PATH) 
    ? `fontfile='${FONT_PATH}':text_shaping=1` 
    : `font='DejaVu Sans':text_shaping=1`;

  if (program || nextTrk || ticker) {
    videoFilter += `;[v1]drawtext=text='${program}':x=30:y=30:fontsize=32:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6:${fontOpt},` +
                   `drawtext=text='${nextTrk}':x=30:y=75:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.4:boxborderw=4:${fontOpt},` +
                   `drawtext=text='${ticker}':x=-tw+mod(t*140\\,w+tw):y=h-50:fontsize=28:fontcolor=white:box=1:boxcolor=red@0.85:boxborderw=10:${fontOpt}[outv]`;
  } else {
    videoFilter += `;[v1]null[outv]`;
  }

  let ffmpegArgs = [
    '-re',
    '-reconnect', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '10',
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    '-i', activeVideoUrl,
    '-i', logoUrl,
    '-filter_complex', videoFilter,
    '-map', '[outv]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-b:v', '2500k',
    '-maxrate', '2500k',
    '-bufsize', '5000k',
    '-pix_fmt', 'yuv420p',
    '-g', '30',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2'
  ];

  let targets = [];
  if (fbTarget) targets.push(`[f=flv:onfail=ignore]${fbTarget}`);
  if (ytTarget) targets.push(`[f=flv:onfail=ignore]${ytTarget}`);

  if (targets.length > 0) {
    ffmpegArgs.push('-f', 'tee', targets.join('|'));
  }

  try {
    console.log(`▶ Starting Track [Index ${trackIndex}]: ${activeVideoUrl}`);
    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    if (ffmpegProcess) {
      // ۵ سيڪنڊ پهرين آٽو تبديلي جو ٽائيمر سيٽ ڪريو
      const duration = await getVideoDuration(activeVideoUrl);
      if (duration && duration > 10) {
        const switchDelay = (duration - 5) * 1000; // ۵ سيڪنڊ اڳي
        console.log(`⏱️ Track Duration: ${duration.toFixed(1)}s. Auto switch set for ${Math.round(switchDelay / 1000)}s.`);
        
        autoSwitchTimer = setTimeout(() => {
          handleNextTrackAuto();
        }, switchDelay);
      }

      ffmpegProcess.on('close', (code) => {
        console.log(`[FFmpeg Closed] Code: ${code}`);
        ffmpegProcess = null;
        if (autoSwitchTimer) clearTimeout(autoSwitchTimer);
        
        // ان حالت لاءِ جڏهن ٽائيمر سيٽ نه ٿي سگهيو هجي
        if (currentConfig && currentConfig.is_live && !isBusySwitching) {
          handleNextTrackAuto();
        }
      });

      ffmpegProcess.on('error', (err) => {
        console.error("Spawn Error (FFmpeg failed to start):", err.message);
        ffmpegProcess = null;
      });
    }

  } catch (e) {
    console.error("Spawn Error Catch:", e.message);
    ffmpegProcess = null;
  }
}

function stopBroadcaster() {
  if (autoSwitchTimer) {
    clearTimeout(autoSwitchTimer);
    autoSwitchTimer = null;
  }
  if (ffmpegProcess) {
    try {
      ffmpegProcess.removeAllListeners('close');
      ffmpegProcess.kill('SIGKILL');
    } catch (e) {}
    ffmpegProcess = null;
  }
}

setInterval(checkDatabaseState, 1500);

app.get('/', (req, res) => res.send('Engine Active'));
app.listen(PORT, () => console.log(`Server Listening on Port ${PORT}`));
