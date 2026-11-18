// runs in <head> before paint so a saved light/dark choice doesn't flash the other theme
try { var m = localStorage.getItem('dnsck-theme'); if (m === 'light' || m === 'dark') document.documentElement.setAttribute('data-theme', m); } catch (e) {}
