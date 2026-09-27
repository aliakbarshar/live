const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://meywyyvqmrnpbzrzzhvm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let ffmpegProcess = null;
let lastRestartTrigger = null;

console.log("🚀 Server Engine Ready...");

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
      console.log("🔄 Restart Signal Received! Resetting Broadcaster...");
      stopBroadcaster();
      if (config.is_live) {
        startBroadcaster(config);
      }
      return;
    }

    if (!config.is_live && ffmpegProcess) {
      console.log("⏹️ Live signal is OFF. Stopping Broadcaster...");
      stopBroadcaster();
    } else if (config.is_live && !ffmpegProcess) {
      console.log("▶️ Live signal is ON! Starting Broadcaster...");
      startBroadcaster(config);
    }
  } catch (err) {
    console.error("Database Loop Error:", err);
  }
}

function startBroadcaster(config) {
  // Test fallback track in case playlist is empty
  const playlist = (config.playlist && config.playlist.length > 0) 
    ? config.playlist 
    : [{ url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' }];

  const trackIndex = (config.current_track_index !== undefined && playlist[config.current_track_index]) 
    ? config.current_track_index 
    : 0;

  const activeVideoUrl = playlist[trackIndex].url;

  console.log(`🎬 Currently Playing Track URL: ${activeVideoUrl}`);

  let rawKey = config.fb_key ? config.fb_key.trim() : (config.yt_key ? config.yt_key.trim() : '');

  if (!rawKey) {
    console.error("❌ ERROR: Stream Key is missing in database!");
    return;
  }

  let targetUrl = rawKey;
  if (!rawKey.startsWith('rtmp://') && !rawKey.startsWith('rtmps://')) {
    targetUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${rawKey}`;
  }

  // FFmpeg Direct Input Streaming
  let ffmpegArgs = [
    '-re',
    '-stream_loop', '-1',
    '-i', activeVideoUrl,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
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

    ffmpegProcess.stderr.on('data', (data) => {
      console.log(`[FFmpeg Log]: ${data.toString()}`);
    });

    ffmpegProcess.on('error', (err) => {
      console.error("❌ FFmpeg Process Error:", err.message);
    });

    ffmpegProcess.on('close', (code) => {
      console.log(`🔴 FFmpeg Closed with Code: ${code}`);
      ffmpegProcess = null;
    });
  } catch (e) {
    console.error("❌ Exception when starting FFmpeg:", e.message);
  }
}

function stopBroadcaster() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
    console.log("🛑 Stream Engine Stopped.");
  }
}

setInterval(checkDatabaseState, 5000);

app.get('/', (req, res) => res.send('Stream Engine Running Clean'));
app.listen(PORT, () => console.log(`🌐 Server Running on Port ${PORT}`));
