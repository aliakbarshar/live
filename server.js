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

console.log("🚀 Server Engine Running (High Performance Mode)...");

async function checkDatabaseState() {
  try {
    const { data: config, error } = await supabase
      .from('stream_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !config) return;

    if (config.restart_trigger && config.restart_trigger !== lastRestartTrigger) {
      lastRestartTrigger = config.restart_trigger;
      console.log("🔄 Restart Signal Received! Resetting...");
      stopBroadcaster();
      if (config.is_live) {
        startBroadcaster(config);
      }
      return;
    }

    if (!config.is_live && ffmpegProcess) {
      console.log("⏹️ Stream Command OFF. Stopping Process...");
      stopBroadcaster();
    } else if (config.is_live && !ffmpegProcess) {
      console.log("▶️ Stream Command ON. Starting Ultra Fast Stream...");
      startBroadcaster(config);
    }
  } catch (err) {
    console.error("Database Loop Error:", err);
  }
}

function startBroadcaster(config) {
  const playlist = (config.playlist && config.playlist.length > 0) 
    ? config.playlist 
    : [{ url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' }];

  const trackIndex = (config.current_track_index !== undefined && playlist[config.current_track_index]) 
    ? config.current_track_index 
    : 0;

  const activeVideoUrl = playlist[trackIndex].url;
  console.log(`🎬 Streaming URL: ${activeVideoUrl}`);

  let rawKey = config.fb_key ? config.fb_key.trim() : (config.yt_key ? config.yt_key.trim() : '');

  if (!rawKey) {
    console.error("❌ ERROR: Stream Key is missing!");
    return;
  }

  let targetUrl = rawKey;
  if (!rawKey.startsWith('rtmp://') && !rawKey.startsWith('rtmps://')) {
    targetUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${rawKey}`;
  }

  // Fast Pass-Through Stream Options
  let ffmpegArgs = [
    '-re',
    '-stream_loop', '-1',
    '-i', activeVideoUrl,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'flv',
    targetUrl
  ];

  try {
    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    ffmpegProcess.stderr.on('data', (data) => {
      console.log(`[FFmpeg Logs]: ${data.toString()}`);
    });

    ffmpegProcess.on('error', (err) => {
      console.error("❌ FFmpeg Launch Error:", err.message);
    });

    ffmpegProcess.on('close', (code) => {
      console.log(`🔴 FFmpeg Stopped. Code: ${code}`);
      ffmpegProcess = null;
    });
  } catch (e) {
    console.error("❌ Exception starting FFmpeg:", e.message);
  }
}

function stopBroadcaster() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
    console.log("🛑 Broadcast Stopped.");
  }
}

setInterval(checkDatabaseState, 5000);

app.get('/', (req, res) => res.send('Stream Engine Active'));
app.listen(PORT, () => console.log(`🌐 Web App Active on Port ${PORT}`));
