const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://meywyyvqmrnpbzrzzhvm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let ffmpegProcess = null;

console.log("🚀 Stream Engine Initialized...");

async function checkDatabaseState() {
  try {
    const { data: config, error } = await supabase
      .from('stream_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !config) return;

    if (config.is_live && !ffmpegProcess) {
      startBroadcaster(config);
    } else if (!config.is_live && ffmpegProcess) {
      stopBroadcaster();
    }
  } catch (err) {
    console.error("Loop Error:", err);
  }
}

function startBroadcaster(config) {
  if (!config.fb_key) return;

  const videoUrl = (config.playlist && config.playlist.length > 0) 
    ? config.playlist[0].url 
    : 'https://aliakbarshar.github.io/live/TestTrack1.mp4';

  const cleanKey = config.fb_key.trim();
  const rtmpsUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${cleanKey}`;

  console.log(`🎬 Live Streaming to FB Key: ${cleanKey.substring(0, 8)}...`);

  const ffmpegArgs = [
    '-re',
    '-stream_loop', '-1',
    '-i', videoUrl,
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
    rtmpsUrl
  ];

  ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

  ffmpegProcess.stderr.on('data', (data) => console.log(`[FFmpeg]: ${data.toString()}`));
  ffmpegProcess.on('close', (code) => {
    console.log(`🔴 FFmpeg Stopped: ${code}`);
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

app.get('/', (req, res) => res.send('Live Broadcaster Active!'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
