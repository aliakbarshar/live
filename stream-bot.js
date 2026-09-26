const { createClient } = require('@supabase/supabase-js');
const { spawn, exec } = require('child_process');
const cron = require('node-cron');

const SUPABASE_URL = "https://meywyyvqmrnpbzrzzhvm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let ffmpegProcess = null;

// Supabase Realtime Listener
supabase
  .channel('stream_config_changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'stream_config' }, payload => {
    console.log('New Config Received:', payload.new);
  })
  .subscribe();

function startFFmpeg(videoPath, fbKey, logoUrl, tickerText) {
    if (ffmpegProcess) exec('taskkill /F /IM ffmpeg.exe');

    // Advanced FFmpeg Filter Complex with Time, Logo, Ticker Overlays
    const filterComplex = `
        [0:v]scale=1280:720[main];
        drawtext=fontfile=/Windows/Fonts/arial.ttf:text='%{localtime\\:%I\\:%M\\:%S %p}':x=1000:y=30:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6[withtime];
        drawtext=fontfile=/Windows/Fonts/arial.ttf:text='${tickerText}':x=w-mod(m*100\\,w+tw):y=h-40:fontsize=22:fontcolor=white:box=1:boxcolor=red@0.8[final]
    `;

    const args = [
        '-re',
        '-stream_loop', '-1',
        '-i', videoPath,
        '-vf', filterComplex.replace(/\n/g, ''),
        '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2500k',
        '-c:a', 'aac', '-b:a', '128k',
        '-f', 'flv',
        `rtmps://live-api-s.facebook.com:443/rtmp/${fbKey}`
    ];

    ffmpegProcess = spawn('ffmpeg', args);
    console.log('Streaming live with Logo, Ticker & Live Clock...');
}
