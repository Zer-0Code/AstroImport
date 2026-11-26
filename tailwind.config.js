export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { astro: { black:'#050505', surface:'#0D0B14', surface2:'#15111F', border:'#2A2140', white:'#FDFDFD', gray:'#92929E',
      violet:{300:'#C9A2FF',400:'#AF70FD',500:'#9050FF',600:'#7A27FD',700:'#6D1FF2'} } },
    backgroundImage: { 'astro-gradient':'linear-gradient(135deg,#6D1FF2 0%,#9050FF 55%,#AF70FD 100%)' },
    boxShadow: { 'astro-glow':'0 0 32px rgba(144,80,255,.35)' },
    borderRadius: { astro:'1rem' } } },
}
