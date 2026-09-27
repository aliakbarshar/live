const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Supabase Setup
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://meywyyvqmrnpbzrzzhvm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let ffmpegProcess = null;
let lastRestartTrigger = null;

console.log("🚀 Stream Engine Starting...");

async function checkDatabaseState() {
  try {
    const { data: config, error } = await supabase
      .from('stream_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !config) return;

    // Track Change Trigger
    if (config.restart_trigger && config.restart_trigger !== lastRestartTrigger) {
      lastRestartTrigger = config.restart_trigger;
      console.log("🔄 Changing track now...");
      stopBroadcaster();
      if (config.is_live) {
        startBroadcaster(config);
      }
      return;
    }

    if (!config.is_live && ffmpegProcess) {
      console.log("⏹️ Stopping Stream...");
      stopBroadcaster();
    } else if (config.is_live && !ffmpegProcess) {
      console.log("▶️ Launching Live Stream...");
      startBroadcaster(config);
    }
  } catch (err) {
    console.error("Database Loop Error:", err);
  }
}

function getLogoOverlayPosition(pos) {
  switch (pos) {
    case 'top-left':
      return 'overlay=20:20';
    case 'bottom-left':
      return 'overlay=20:main_h-overlay_h-20';
    case 'bottom-right':
      return 'overlay=main_w-overlay_w-20:main_h-overlay_h-20';
    case 'top-right':
    default:
      return 'overlay=main_w-overlay_w-20:20';
  }
}

function startBroadcaster(config) {
  const playlist = (config.playlist && config.playlist.length > 0) 
    ? config.playlist 
    : [{ url: 'https://aliakbarshar.github.io/live/TestTrack1.mp4' }];

  const trackIndex = (config.current_track_index !== undefined && playlist[config.current_track_index]) 
    ? config.current_track_index 
    : 0;

  const orderedPlaylist = [...playlist.slice(trackIndex), ...playlist.slice(0, trackIndex)];

  const playlistPath = path.join(__dirname, 'playlist.txt');
  const playlistContent = orderedPlaylist.map(item => `file '${item.url}'`).join('\n');
  fs.writeFileSync(playlistPath, playlistContent);

  const logoUrl = config.logo_url || 'https://aliakbarshar.github.io/live/logo.png';
  const logoPos = config.logo_pos || 'top-right';
  const logoWidth = config.logo_width || 120;
  const tickerText = config.ticker_text || config.overlay_text || '';

  const overlayPosFilter = getLogoOverlayPosition(logoPos);

  const outputs = [];

  // FB Key processing - Auto detect if user pasted full URL or just key
  if (config.fb_key && config.fb_key.trim() !== '') {
    const rawFbKey = config.fb_key.trim();
    if (rawFbKey.startsWith('rtmp://') || rawFbKey.startsWith('rtmps://')) {
      outputs.push(rawFbKey);
    } else {
      outputs.push(`rtmps://live-api-s.facebook.com:443/rtmp/${rawFbKey}`);
    }
  }

  // YT Key processing
  if (config.yt_key && config.yt_key.trim() !== '') {
    const rawYtKey = config.yt_key.trim();
    if (rawYtKey.startsWith('rtmp://') || rawYtKey.startsWith('rtmps://')) {
      outputs.push(rawYtKey);
    } else {
      outputs.push(`rtmp://a.rtmp.youtube.com/live2/${rawYtKey}`);
    }
  }

  if (outputs.length === 0) {
    console.error("❌ No valid Stream Keys found!");
    return;
  }

  console.log(`🎬 Stream Active. Destinations Count: ${outputs.length}`);

  let filterComplex = `[1:v]scale=${logoWidth}:-1[logo];[0:v][logo]${overlayPosFilter}[vlogo]`;
  let finalVideoMap = '[vlogo]';

  if (tickerText) {
    filterComplex += `;[vlogo]drawtext=text='${tickerText}':x=w-mod(t*100\\,w+tw):y=h-50:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6[vout]`;
    finalVideoMap = '[vout]';
  }

  let ffmpegArgs = [
    '-re',
    '-f', 'concat',
    '-safe', '0',
    '-stream_loop', '-1',
    '-i', playlistPath,
    '-i', logoUrl,
    '-filter_complex', filterComplex,
    '-map', finalVideoMap,
    '-map', '0:a',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', '2500k',
    '-maxrate', '2500k',
    '-bufsize', '5000k',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100'
  ];

  if (outputs.length === 1) {
    ffmpegArgs.push('-f', 'flv', outputs[0]);
  } else {
    ffmpegArgs.push(
      '-f', 'tee',
      `-map`, finalVideoMap, `-map`, `0:a`,
      `[f=flv]${outputs[0]}|[f=flv]${outputs[1]}`
    );
  }

  ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

  ffmpegProcess.stderr.on('data', (data) => {
    console.log(`[FFmpeg Log]: ${data.toString()}`);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`🔴 Stream Stopped with code: ${code}`);
    ffmpegProcess = null;
  });
}

function stopBroadcaster() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
  }
}

setInterval(checkDatabaseState, 5000);

app.get('/', (req, res) => res.send('Stream Engine Running...'));
app.listen(PORT, () => console.log(`🌐 App listening on port ${PORT}`));
