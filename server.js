const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://meywyyvqmrnpbzrzzhvm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let ffmpegProcess = null;
let lastRestartTrigger = null;
let currentConfig = null;

// 🔹 فونٽ فائيل پاتھ
const FONT_PATH = './sindhi.ttf';

console.log("🚀 Live Studio Pro Engine Starting...");

async function checkDatabaseState() {
  try {
    const { data: config, error } = await supabase
      .from('stream_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !config) return;

    currentConfig = config;

    // جيئن ئي Trigger يا Settings تبديل ٿين
    if (config.restart_trigger && config.restart_trigger !== lastRestartTrigger) {
      lastRestartTrigger = config.restart_trigger;
      console.log("🔄 Trigger Changed! Restarting Stream...");
      stopBroadcaster();
      if (config.is_live) {
        startBroadcaster(config);
      }
      return;
    }

    if (!config.is_live && ffmpegProcess) {
      console.log("⏹️ Live Signal OFF. Stopping...");
      stopBroadcaster();
    } else if (config.is_live && !ffmpegProcess) {
      console.log("▶️ Live Signal ON. Launching Broadcaster...");
      startBroadcaster(config);
    }
  } catch (err) {
    console.error("Database Loop Error:", err);
  }
}

function startBroadcaster(config) {
  stopBroadcaster();

  const playlist = (config.playlist && config.playlist.length > 0) 
    ? config.playlist 
    : [{ url: 'https://ia600404.us.archive.org/25/items/mran_20260927_202609/mran.mp4' }];

  let trackIndex = config.current_track_index || 0;
  if (trackIndex >= playlist.length) trackIndex = 0;

  const activeVideoUrl = playlist[trackIndex].url;

  let fbKey = config.fb_key ? config.fb_key.trim() : '';
  let ytKey = config.yt_key ? config.yt_key.trim() : '';

  if (!fbKey && !ytKey) return;

  let fbTarget = fbKey ? (fbKey.startsWith('rtmp') ? fbKey : `rtmps://live-api-s.facebook.com:443/rtmp/${fbKey}`) : '';
  let ytTarget = ytKey ? (ytKey.startsWith('rtmp') ? ytKey : `rtmp://a.rtmp.youtube.com/live2/${ytKey}`) : '';

  const program = config.program_name || '';
  const nextTrk = config.next_track || '';
  const ticker = config.ticker_text || '';
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
    videoFilter += `[outv]`;
  }

  let ffmpegArgs = [
    '-re',
    '-stream_loop', '-1', // 🔹 ٽريڪ کي آٽوميٽڪ نئين سر چالو رکڻ لاءِ (Stream Drop نہ ٿيندي)
    '-reconnect', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
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
    '-g', '60',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100'
  ];

  if (fbTarget) ffmpegArgs.push('-f', 'flv', fbTarget);
  if (ytTarget) ffmpegArgs.push('-f', 'flv', ytTarget);

  try {
    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    ffmpegProcess.on('close', (code) => { 
      ffmpegProcess = null;
      console.log(`[FFmpeg Closed]: Code ${code}`);
    });
  } catch (e) {
    console.error("Spawn Error:", e.message);
  }
}

function stopBroadcaster() {
  if (ffmpegProcess) {
    ffmpegProcess.removeAllListeners('close');
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
  }
}

setInterval(checkDatabaseState, 4000);

app.get('/', (req, res) => res.send('Engine Active'));
app.listen(PORT, () => console.log(`Server Active on Port ${PORT}`));
