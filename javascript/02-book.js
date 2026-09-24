/* Encounter Coffee Beans — 本のめくり制御・サイドメニュー開閉 */
window.addEventListener("load", function(){
  fitStage();

  /* ── 本のサイズを画面に合わせて決める ──
     PC：見開き（2ページ分）が左右余白100pxに収まり、縦も画面内に収まる大きさ。
     スマホ：基本 340×460。画面幅が狭い端末（幅 372px 未満）では
             左右16pxの余白を残して縮める（表紙の文字がはみ出して中央からずれるのを防ぐ）。 */
  const BOOK_BASE_W = 340, BOOK_BASE_H = 460;
  function isPC(){ return document.documentElement.clientWidth >= 900; }
  function calcBookSize(){
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (vw < 900){
      const w = Math.max(260, Math.min(BOOK_BASE_W, vw - 32));
      return { w: w, h: Math.round(w * BOOK_BASE_H / BOOK_BASE_W) };
    }
    const SIDEBAR = 240, MARGIN = 100;
    const availW = (vw - SIDEBAR - MARGIN * 2) / 2;   // 見開きなので半分が1ページ分
    const availH = vh - 210;                          // 見出し・ボタン・余白の分を引く
    const scale = Math.min(availW / BOOK_BASE_W, availH / BOOK_BASE_H, 1.6);
    const s = Math.max(0.8, scale);
    return { w: Math.round(BOOK_BASE_W * s), h: Math.round(BOOK_BASE_H * s) };
  }
  function applyBookSize(size){
    document.documentElement.style.setProperty("--book-w", size.w + "px");
    document.documentElement.style.setProperty("--book-h", size.h + "px");
  }
  let bookSize = calcBookSize();
  applyBookSize(bookSize);

  /* ── 本のメニュー初期化 ── */
  const hint = document.querySelector(".hint");
  const bookWrap = document.querySelector(".book-wrap");
  if (typeof St === "undefined"){
    hint.textContent = "⚠ ライブラリの読み込みに失敗しました。接続を確認して再読み込みしてください。";
  } else {
    try{
      const FLIP_MS  = 600;   // めくりの時間
      const SLIDE_MS = 480;   // 本が横に移動する時間
      const pageFlip = new St.PageFlip(document.getElementById("book"), {
        width: bookSize.w,
        height: bookSize.h,
        size: "fixed",
        showCover: true,
        mobileScrollSupport: false,
        showPageCorners: false,     /* ホバーでの角めくり・影を無効化 */
        maxShadowOpacity: .3,       /* 影を薄くして描画負荷を下げる */
        flippingTime: FLIP_MS
      });
      pageFlip.loadFromHTML(document.querySelectorAll(".page"));
      const LAST = pageFlip.getPageCount() - 1;
      document.getElementById("total").textContent = LAST + 1;

      const prevBtn = document.getElementById("prev");
      const nextBtn = document.getElementById("next");
      const tapPrevBtn = document.getElementById("tapPrev");
      const tapNextBtn = document.getElementById("tapNext");

      /* ── 本の位置（PCのみ効く。スマホでは CSS 側で無視される） ──
         center … 表紙・裏表紙（画像1・5の位置）
         right  … 開いた状態の右ページ（画像2・3の位置。左に空白ページ）
         left   … 裏表紙が閉じた直後（画像4の位置） */
      function posFor(idx){ return (idx <= 0 || idx >= LAST) ? "center" : "right"; }
      function setPos(pos, dur){
        if (!bookWrap) return;
        bookWrap.style.setProperty("--slide-dur", (dur == null ? SLIDE_MS : dur) + "ms");
        bookWrap.dataset.pos = pos;
      }
      function setBlank(show){ if (bookWrap) bookWrap.classList.toggle("show-blank", show); }
      /* アニメーション無しで、いまのページに合った位置へ置く（初期表示・リサイズ時） */
      function snapTo(idx){
        if (!bookWrap) return;
        bookWrap.classList.add("no-anim");
        setPos(posFor(idx), 0);
        setBlank(posFor(idx) === "right");
        void bookWrap.offsetWidth;                 // 反映させてから no-anim を外す
        bookWrap.classList.remove("no-anim");
      }
      const wait = (ms) => new Promise(r => setTimeout(r, ms));

      /* ── めくり完了を待つ ──
         changeState が "read"（待機）に戻る or flip イベント、どちらか早い方。
         どちらも来ない場合に備えて時間切れでも進める。 */
      let flipWaiter = null;
      function doFlip(action){
        return new Promise(resolve => {
          let done = false;
          const finish = () => { if (done) return; done = true; flipWaiter = null; clearTimeout(t); resolve(); };
          const t = setTimeout(finish, FLIP_MS + 500);
          flipWaiter = finish;
          try{ action(); }catch(e){ finish(); }
        });
      }
      pageFlip.on("flip", e => {
        document.getElementById("current").textContent = e.data + 1;
        updateNav(e.data);
        if (flipWaiter) setTimeout(() => flipWaiter && flipWaiter(), 30);
      });
      pageFlip.on("changeState", (e) => {
        const flipping = (e.data !== "read");
        /* めくり中は重い背景描画を止める（02-book.css の .is-flipping） */
        if (bookWrap) bookWrap.classList.toggle("is-flipping", flipping);
        if (!flipping && flipWaiter) flipWaiter();
      });

      function flipNextRaw(){ try{ pageFlip.flipNext(); }catch(e){ pageFlip.turnToNextPage(); } }
      function flipPrevRaw(){ try{ pageFlip.flipPrev(); }catch(e){ pageFlip.turnToPrevPage(); } }
      function flipToRaw(n){ try{ pageFlip.flip(n); }catch(e){ pageFlip.turnToPage(n); } }
      function curIdx(){ try{ return pageFlip.getCurrentPageIndex(); }catch(e){ return 0; } }

      /* ── 連打ガード：移動＋めくりの一連の動きが終わるまで次の操作を受け付けない ── */
      let busy = false;
      function setBusy(b){
        busy = b;
        if (bookWrap) bookWrap.classList.toggle("is-moving", b);
      }

      /* ── 指定ページへ移動（ボタン・タップ・目次リンク共通） ── */
      async function goTo(target){
        if (busy) return;
        const from = curIdx();
        target = Math.max(0, Math.min(LAST, target));
        if (target === from) return;
        const forward = target > from;
        const step = (target === from + 1) ? flipNextRaw
                   : (target === from - 1) ? flipPrevRaw
                   : () => flipToRaw(target);
        setBusy(true);
        try{
          if (!isPC()){
            /* スマホ：これまでどおり、その場でめくるだけ */
            await doFlip(step);
          } else if (forward && from === 0){
            /* 表紙を開く：中央 → 右へ移動（画像1→2）してから見開きを開く（画像3） */
            setPos("right");
            await wait(SLIDE_MS);
            setBlank(true);
            await doFlip(step);
            if (target >= LAST){ setBlank(false); setPos("center"); await wait(SLIDE_MS); }
          } else if (forward && target >= LAST){
            /* 最終ページへ：めくりながら左へ移動（画像4）→ 中央へ（画像5） */
            await closeToEnd(step);
          } else if (!forward && from >= LAST){
            /* 裏表紙から戻る：中央 → 左（画像4の位置）→ めくりながら右へ戻る */
            setPos("left");
            await wait(SLIDE_MS);
            setPos("right", FLIP_MS);
            setBlank(true);
            await doFlip(step);
            if (target <= 0){ setBlank(false); setPos("center"); await wait(SLIDE_MS); }
          } else if (!forward && target <= 0){
            /* 表紙へ戻る：表紙を閉じてから中央へ */
            await closeToCover(step);
          } else {
            /* 中のページどうし：位置はそのまま */
            await doFlip(step);
          }
        } finally {
          setBusy(false);
          updateNav(curIdx());
        }
      }
      /* 最後のページをめくって裏表紙を閉じ、中央へ戻す */
      async function closeToEnd(step){
        setPos("left", FLIP_MS);
        setBlank(false);
        await doFlip(step);
        await wait(160);                       // 画像4の位置でひと呼吸
        setPos("center");
        await wait(SLIDE_MS);
      }
      /* 表紙を閉じて中央へ戻す */
      async function closeToCover(step){
        setBlank(false);
        await doFlip(step);
        setPos("center");
        await wait(SLIDE_MS);
      }

      const goPrev = () => goTo(curIdx() - 1);
      const goNext = () => goTo(curIdx() + 1);
      prevBtn.addEventListener("click", goPrev);
      nextBtn.addEventListener("click", goNext);
      tapPrevBtn.addEventListener("click", goPrev);
      tapNextBtn.addEventListener("click", goNext);

      /* 始端・終端では該当ボタンを無効化 */
      function updateNav(idx){
        const atStart = idx <= 0;
        const atEnd   = idx >= LAST;
        prevBtn.disabled = atStart; tapPrevBtn.disabled = atStart;
        nextBtn.disabled = atEnd;   tapNextBtn.disabled = atEnd;
      }
      updateNav(0);
      snapTo(0);

      /* ウィンドウ幅・高さが変わったら本のサイズを作り直す
         （PC⇔スマホの切り替えや、ウィンドウのリサイズに追従） */
      function rebuildIfNeeded(){
        if (busy) return;                      // 動きの途中は作り直さない
        const next = calcBookSize();
        if (next.w === bookSize.w && next.h === bookSize.h) return;
        const cur = curIdx();
        bookSize = next;
        applyBookSize(bookSize);
        try{
          pageFlip.update({ width: bookSize.w, height: bookSize.h, size: "fixed" });
          pageFlip.turnToPage(cur);
        }catch(e){ /* 失敗しても表示は維持される */ }
      }
      let zoomTimer = null;
      function scheduleRefresh(){
        clearTimeout(zoomTimer);
        zoomTimer = setTimeout(() => {
          if (busy){ scheduleRefresh(); return; }
          rebuildIfNeeded();
          const cur = curIdx();
          updateNav(cur);
          snapTo(cur);
        }, 250);
      }
      if (window.visualViewport){
        window.visualViewport.addEventListener("resize", scheduleRefresh);
        window.visualViewport.addEventListener("scroll", scheduleRefresh);
      }
      window.addEventListener("resize", scheduleRefresh);
      window.addEventListener("orientationchange", scheduleRefresh);

      /* 目次リンク：指定ページへ移動 */
      document.querySelectorAll(".toc-link").forEach(a => {
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          const n = parseInt(a.dataset.page, 10);
          if (!isNaN(n)) goTo(n);
        });
      });
    }catch(err){
      hint.textContent = "⚠ 初期化エラー: " + err.message;
      console.error(err);
    }
  }

  initSideMenu();
});

/* ── サイドメニュー開閉 ──
   本の初期化とは切り離して定義する。
   （同じ処理の中に置くと、本側でエラーが起きたときにメニューまで動かなくなるため） */
function initSideMenu(){
  const toggle  = document.getElementById("menuToggle");
  const menu    = document.getElementById("sideMenu");
  const overlay = document.getElementById("overlay");
  if (!toggle || !menu || !overlay) return;      // 要素が無い環境では何もしない
  if (toggle.dataset.ecbBound === "1") return;   // 二重登録の防止
  toggle.dataset.ecbBound = "1";

  const mtLabel = toggle.querySelector(".mt-label");
  function setMenu(open){
    menu.classList.toggle("open", open);
    overlay.classList.toggle("show", open);
    toggle.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open);
    toggle.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
    if (mtLabel) mtLabel.textContent = open ? "CLOSE" : "MENU";
  }
  toggle.addEventListener("click", () => setMenu(!menu.classList.contains("open")));
  overlay.addEventListener("click", () => setMenu(false));
  menu.querySelectorAll("a").forEach(a => a.addEventListener("click", () => setMenu(false)));
  document.addEventListener("keydown", e => { if (e.key === "Escape") setMenu(false); });
}

/* load を待たずに、DOMが使える時点でもメニューだけ先に有効化する
   （BASEのテーマによっては load イベントが遅れる・発火済みのことがあるため） */
if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", initSideMenu);
} else {
  initSideMenu();
}