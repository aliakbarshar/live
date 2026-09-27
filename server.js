// Studio Overlays setup with proper text encoding
  const program = config.program_name || 'LIVE BROADCAST';
  const nextTrk = config.next_track || '';
  const ticker = config.ticker_text || 'ڀليڪار! اسٽريم اسٽوڊيو لائيِو براڊڪاسٽنگ';

  // Direct position calculations:
  // Marquee ticker moving from Left-to-Right: x=-tw+mod(t*120\,w+tw)
  let videoFilter = `drawtext=text='${program}':x=30:y=30:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=5,` +
                    `drawtext=text='${nextTrk}':x=30:y=65:fontsize=20:fontcolor=yellow:box=1:boxcolor=black@0.4:boxborderw=3,` +
                    `drawtext=text='${ticker}':x=-tw+mod(t*150\\,w+tw):y=h-45:fontsize=24:fontcolor=white:box=1:boxcolor=red@0.8:boxborderw=8`;

  let ffmpegArgs = [
    '-re',
    '-reconnect', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    '-stream_loop', '-1',
    '-i', activeVideoUrl,
    '-vf', videoFilter,
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
