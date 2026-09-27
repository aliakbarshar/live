const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://meywyyvqmrnpbzrzzhvm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let ffmpegProcess = null;
let lastRestartTrigger = null;
let currentConfig = null;

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

    if (config.restart_trigger && config.restart_trigger !== lastRestartTrigger) {
      lastRestartTrigger = config.restart_trigger;
      console.log("🔄 Settings Changed! Restarting Stream...");
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

async function playNextTrackInPlaylist() {
  if (!currentConfig || !currentConfig.playlist || currentConfig.playlist.length === 0) return;
  
  const totalTracks = currentConfig.playlist.length;
  let nextIndex = ((currentConfig.current_track_index || 0) + 1) % totalTracks;

  console.log(`🎵 Track finished. Moving automatically to Track index: ${nextIndex}`);

  await supabase.from('stream_config').update({
    current_track_index: nextIndex,
    restart_trigger: Date.now()
  }).eq('id', 1);
}

function startBroadcaster(config) {
  const playlist = (config.playlist && config.playlist.length > 0) 
    ? config.playlist 
    : [{ url: 'https://ia600404.us.archive.org/25/items/mran_20260927_202609/mran.mp4' }];

  const trackIndex = (config.current_track_index !== undefined && playlist[config.current_track_index]) 
    ? config.current_track_index 
    : 0;

  const activeVideoUrl = playlist[trackIndex].url;

  let rawKey = config.fb_key ? config.fb_key.trim() : (config.yt_key ? config.yt_key.trim() : '');
  if (!rawKey) return;

  let targetUrl = rawKey;
  if (!rawKey.startsWith('rtmp://') && !rawKey.startsWith('rtmps://')) {
    if (config.fb_key && config.fb_key.trim() !== '') {
      targetUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${config.fb_key.trim()}`;
    } else if (config.yt_key && config.yt_key.trim() !== '') {
      targetUrl = `rtmp://a.rtmp.youtube.com/live2/${config.yt_key.trim()}`;
    }
  }

  // Overlay Config
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
  
  // Cleaned Font Options (Compatible with Render FFmpeg)
  const fontOpt = "fontfile='./Lateef-Regular.ttf'";

  if (program || nextTrk || ticker) {
    videoFilter += `;[v1]drawtext=text='${program}':x=30:y=30:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6:${fontOpt},` +
                   `drawtext=text='${nextTrk}':x=30:y=70:fontsize=20:fontcolor=yellow:box=1:boxcolor=black@0.4:boxborderw=4:${fontOpt},` +
                   `drawtext=text='${ticker}':x=-tw+mod(t*140\\,w+tw):y=h-50:fontsize=26:fontcolor=white:box=1:boxcolor=red@0.85:boxborderw=10:${fontOpt}[outv]`;
  } else {
    videoFilter += `[outv]`;
  }

  let ffmpegArgs = [
    '-re',
    '-reconnect', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    '-i', activeVideoUrl,
    '-i', logoUrl,
    '-filter_complex', videoFilter,
    '-map', '[outv]',
    '-map', '0:a',
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
    '-ar', '44100',
    '-f', 'flv',
    targetUrl
  ];

  try {
    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    
    ffmpegProcess.stderr.on('data', (data) => console.log(`[FFmpeg]: ${data.toString()}`));
    
    ffmpegProcess.on('close', (code) => { 
      ffmpegProcess = null;
      if (code === 0 || code === null) {
        playNextTrackInPlaylist();
      }
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

setInterval(checkDatabaseState, 5000);

app.get('/', (req, res) => res.send('Engine Active'));
app.listen(PORT, () => console.log(`Server Active on Port ${PORT}`));
