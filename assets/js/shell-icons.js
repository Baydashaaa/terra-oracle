// Иконки оболочки. Вынуто из preview/index.html при переносе дизайна.
(function(){
const ICONS = {
  home:'M3 11l9-8 9 8M5 10v10h14V10',
  chat:'M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z',
  oracle:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v4l3 2',
  dice:'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  grid:'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  chart:'M4 20V10M10 20V4M16 20v-7M22 20H2',
  scale:'M12 3v18M7 7l-4 8h8zM17 7l-4 8h8zM4 7h16',
  bank:'M3 10h18M5 10v8M19 10v8M12 10v8M2 21h20M12 3l9 5H3z',
  book:'M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zM8 3v16',
  cup:'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M9 20h6M12 14v6',
  star:'M12 3l2.7 5.9 6.3.7-4.7 4.3 1.3 6.1L12 17l-5.6 3 1.3-6.1L3 9.6l6.3-.7z',
  cards:'M8 6h11v13H8zM5 4v13M2 8v8',
  users:'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
  coin:'M12 3a9 5 0 1 0 0 10 9 5 0 0 0 0-10zM3 8v8a9 5 0 0 0 18 0V8',
  wallet:'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 8V6.2A1.2 1.2 0 0 1 4.2 5h11.3M21 11h-4a1.5 1.5 0 0 0 0 3h4',
  bell:'M18 9a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7M10 21a2 2 0 0 0 4 0',
  search:'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  bolt:'M13 2L4 14h6l-1 8 9-12h-6z',
  arrow:'M5 12h14M13 6l6 6-6 6',
  send:'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  x:'M4 4l16 16M20 4L4 20',
  code:'M9 18l-6-6 6-6M15 6l6 6-6 6'
};
document.querySelectorAll('[data-i]').forEach(el=>{
  const d = ICONS[el.dataset.i]; if(!d) return;
  el.outerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '+
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+d+'"/></svg>';
});
})();
