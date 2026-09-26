require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');

// Supabase Client Initialization
const SUPABASE_URL = process.env.SUPABASE_URL || "https://meywyyvqmrnpbzrzzhvm.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "YOUR_SERVICE_ROLE_OR_ANON_KEY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// System Executables Path
const FFMPEG_PATH = 'ffmpeg';
const YTDLP_PATH = 'yt-dlp';

let activeStreamProcess = null;

// Fetch Settings from Supabase stream_settings (id = 1)
async function getStreamSettings() {
    try {
        const { data, error } = await supabase
            .from('stream_settings')
            .select('*')
            .eq('id', 1)
            .single();

        if (error) throw error;
        return data;
    } catch (err) {
        console.error('❌ Error reading stream_settings from Supabase:', err.message);
        return null;
    }
}

// Start Automated Stream Loop
async function startAutomatedStream() {
    console.log('\n📡 Checking stream settings from Admin Portal...');
    const settings = await getStreamSettings();

    if (!settings) {
        console.log('⚠️ Could not load settings. Retrying in 10s...');
        setTimeout(startAutomatedStream, 10000);
        return;
    }

    // Check if master switch 'is_live' is turned on
    if (settings.is_live === false) {
        console.log('⏸️ Broadcast Master Switch is OFF (OFFLINE). Waiting for trigger...');
        setTimeout(startAutomatedStream, 5000);
        return;
    }

    const videoSource = settings.video_source;
    const fbStreamKey = settings.fb_stream_key;

    if (!videoSource || !fbStreamKey) {
        console.log('⚠️ Missing Video Source ID or Facebook Stream Key in Supabase. Checking again in 10s...');
        setTimeout(startAutomatedStream, 10000);
        return;
    }

    // Build full YouTube URL if only Video ID (11 chars) was pasted in Admin Panel
    let fullVideoUrl = videoSource;
    if (videoSource.length === 11 && !videoSource.startsWith('http')) {
        fullVideoUrl = `https://www.youtube.com/watch?v=${videoSource}`;
    }

    const rtmpDestination = `rtmps://live-api-s.facebook.com:443/rtmp/${fbStreamKey}`;

    console.log(`🚀 Master Switch LIVE! Launching stream for video: ${fullVideoUrl}`);

    // Extract raw stream URL using yt-dlp
    const ytdlpProcess = spawn(YTDLP_PATH, ['-g', fullVideoUrl]);
    let directStreamUrl = '';

    ytdlpProcess.stdout.on('data', (chunk) => {
        directStreamUrl += chunk.toString().trim();
    });

    ytdlpProcess.on('close', (code) => {
        if (code !== 0 || !directStreamUrl) {
            console.error('❌ Failed to fetch direct video stream URL. Retrying in 5s...');
            setTimeout(startAutomatedStream, 5000);
            return;
        }

        console.log('✅ Direct media link extracted. Launching FFmpeg Engine...');

        // FFmpeg streaming arguments
        const ffmpegArgs = [
            '-re',
            '-i', directStreamUrl,
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-b:v', '2500k',
            '-maxrate', '2500k',
            '-bufsize', '5000k',
            '-pix_fmt', 'yuv420p',
            '-g', '50',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            '-f', 'flv',
            rtmpDestination
        ];

        activeStreamProcess = spawn(FFMPEG_PATH, ffmpegArgs);

        activeStreamProcess.stderr.on('data', (data) => {
            const output = data.toString();
            if (output.includes('frame=') || output.includes('fps=')) {
                process.stdout.write(`\r📺 Streaming Progress: ${output.substring(0, 60)}`);
            }
        });

        activeStreamProcess.on('close', (exitCode) => {
            console.log(`\n🔴 Stream process stopped (Code: ${exitCode}). Restarting playlist loop in 3s...`);
            activeStreamProcess = null;
            setTimeout(startAutomatedStream, 3000);
        });
    });
}

// Realtime Listener for Instant Broadcast Toggle (Start/Stop from Admin Panel)
function listenForRealtimeUpdates() {
    console.log('⚡ Listening to Supabase Realtime changes for Admin Panel updates...');
    
    supabase
        .channel('public:stream_settings')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stream_settings' }, (payload) => {
            const updated = payload.new;
            console.log('\n🔔 Realtime Update Received from Admin Portal!');

            // If user clicked "Stop Stream" in Admin Panel
            if (updated.is_live === false && activeStreamProcess) {
                console.log('🛑 Stop Broadcast signal received from Admin Portal. Terminating FFmpeg...');
                activeStreamProcess.kill('SIGINT');
            }
        })
        .subscribe();
}

// Initialize Bot
startAutomatedStream();
listenForRealtimeUpdates();
