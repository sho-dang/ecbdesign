/* Encounter Coffee Beans — 本のめくり制御・サイドメニュー開閉 */
window.addEventListener("load", function(){
  fitStage();

  /* ── 本のサイズを画面に合わせて決める ──
     PC：見開き（2ページ分）の幅を「サイドメニューを除いた幅 − 左右余白」と 800px の小さい方に収める。
         縦も画面内に収まるように縮める。
     スマホ：基本 340×460。画面幅が狭い端末（幅 372px 未満）では左右16pxの余白を残して縮める。 */
  const BOOK_BASE_W = 340, BOOK_BASE_H = 460;
  const PC_MIN = 900, SIDEBAR = 240, PC_SIDE_MARGIN = 40, PC_MAX_SPREAD = 800;
  function isPC(){ return document.documentElement.clientWidth >= PC_MIN; }
  function calcBookSize(){
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (vw < PC_MIN){
      const w = Math.max(260, Math.min(BOOK_BASE_W, vw - 32));
      return { w: w, h: Math.round(w * BOOK_BASE_H / BOOK_BASE_W) };
    }
    const spread = Math.min(PC_MAX_SPREAD, vw - SIDEBAR - PC_SIDE_MARGIN * 2);
    let w = Math.floor(spread / 2);                               // 見開きなので半分が1ページ分
    const maxH = vh - 210;                                        // 見出し・ボタン・余白の分を引く
    if (w * BOOK_BASE_H / BOOK_BASE_W > maxH) w = Math.floor(maxH * BOOK_BASE_W / BOOK_BASE_H);
    w = Math.max(200, w);
    return { w: w, h: Math.round(w * BOOK_BASE_H / BOOK_BASE_W) };
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

      const prevBtn = document.getElementById("prev");
      const nextBtn = document.getElementById("next");
      const tapPrevBtn = document.getElementById("tapPrev");
      const tapNextBtn = document.getElementById("tapNext");

      /* ページのHTMLを最初に控えておく。
         めくりライブラリは作成後に大きさを変えられないため、画面サイズが変わったら
         本をいったん壊して、この控えから作り直す（Ver9：縮小時に右ページがずれる不具合の対策）。 */
      const PAGES_HTML = Array.prototype.map.call(
        document.querySelectorAll("#book .page"), p => p.outerHTML).join("");

      let pageFlip = null;
      let LAST = 0;
      function createBook(startPage){
        let el = document.getElementById("book");
        if (!el){
          el = document.createElement("div");
          el.id = "book";
          bookWrap.insertBefore(el, tapPrevBtn);
        }
        el.innerHTML = PAGES_HTML;
        pageFlip = new St.PageFlip(el, {
          width: bookSize.w,
          height: bookSize.h,
          size: "fixed",
          startPage: startPage || 0,
          showCover: true,
          mobileScrollSupport: false,
          showPageCorners: false,     /* ホバーでの角めくり・影を無効化 */
          maxShadowOpacity: .3,       /* 影を薄くして描画負荷を下げる */
          flippingTime: FLIP_MS
        });
        pageFlip.loadFromHTML(el.querySelectorAll(".page"));
        LAST = pageFlip.getPageCount() - 1;
        pageFlip.on("flip", e => {
          document.getElementById("current").textContent = e.data + 1;
          updateNav(e.data);
          if (flipWaiter) setTimeout(() => flipWaiter && flipWaiter(), 30);
        });
        pageFlip.on("changeState", (e) => {
          const flipping = (e.data !== "read");
          /* めくり中は重い背景描画を止める（02-book.css の .is-flipping） */
          bookWrap.classList.toggle("is-flipping", flipping);
          if (!flipping && flipWaiter) flipWaiter();
        });
        /* 目次リンク：指定ページへ移動（本を作り直すたびに付け直す） */
        el.querySelectorAll(".toc-link").forEach(a => {
          a.addEventListener("click", (ev) => {
            ev.preventDefault();
            const n = parseInt(a.dataset.page, 10);
            if (!isNaN(n)) goTo(n);
          });
        });
        const cur = curIdx();
        document.getElementById("current").textContent = cur + 1;
        document.getElementById("total").textContent = LAST + 1;
        updateNav(cur);
        snapTo(cur);
      }

      /* ── 本の位置（PCのみ効く。スマホでは CSS 側で無視される） ──
         center … 表紙（中央）
         right  … 開いた状態の右ページ（左に空白ページ）
         left   … 裏表紙（左半分の位置のまま止める） */
      function posFor(idx){
        if (idx <= 0) return "center";
        if (idx >= LAST) return "left";
        return "right";
      }
      function setPos(pos, dur){
        bookWrap.style.setProperty("--slide-dur", (dur == null ? SLIDE_MS : dur) + "ms");
        bookWrap.dataset.pos = pos;
      }
      function setBlank(show){ bookWrap.classList.toggle("show-blank", show); }
      /* アニメーション無しで、いまのページに合った位置へ置く（初期表示・リサイズ時） */
      function snapTo(idx){
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

      function flipNextRaw(){ try{ pageFlip.flipNext(); }catch(e){ pageFlip.turnToNextPage(); } }
      function flipPrevRaw(){ try{ pageFlip.flipPrev(); }catch(e){ pageFlip.turnToPrevPage(); } }
      function flipToRaw(n){ try{ pageFlip.flip(n); }catch(e){ pageFlip.turnToPage(n); } }
      function curIdx(){ try{ return pageFlip.getCurrentPageIndex(); }catch(e){ return 0; } }

      /* ── 連打ガード：移動＋めくりの一連の動きが終わるまで次の操作を受け付けない ── */
      let busy = false;
      function setBusy(b){
        busy = b;
        bookWrap.classList.toggle("is-moving", b);
      }

      /* ── 指定ページへ移動（ボタン・タップ・目次リンク共通） ── */
      async function goTo(target){
        if (busy || !pageFlip) return;
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
            /* スマホ：その場でめくるだけ */
            await doFlip(step);
          } else if (forward && from === 0){
            /* 表紙を開く：中央 → 右へ移動してから見開きを開く */
            setPos("right");
            await wait(SLIDE_MS);
            setBlank(true);
            if (target >= LAST){ setPos("left", FLIP_MS); setBlank(false); }
            await doFlip(step);
          } else if (forward && target >= LAST){
            /* 最終ページへ：めくりながら左へ移動し、そのまま左の位置で止める */
            setPos("left", FLIP_MS);
            setBlank(false);
            await doFlip(step);
          } else if (!forward && from >= LAST){
            /* 裏表紙から戻る：左の位置から、めくりながら右へ戻る */
            setPos("right", FLIP_MS);
            setBlank(true);
            await doFlip(step);
            if (target <= 0){ setBlank(false); setPos("center"); await wait(SLIDE_MS); }
          } else if (!forward && target <= 0){
            /* 表紙へ戻る：表紙を閉じてから中央へ */
            setBlank(false);
            await doFlip(step);
            setPos("center");
            await wait(SLIDE_MS);
          } else {
            /* 中のページどうし：位置はそのまま */
            await doFlip(step);
          }
        } finally {
          setBusy(false);
          updateNav(curIdx());
          if (pendingRebuild){ pendingRebuild = false; rebuildIfNeeded(); }
        }
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

      createBook(0);

      /* ── 画面サイズが変わったら本を作り直す ──
         （PC⇔スマホの切り替え、ウィンドウの拡大縮小に追従。ページ位置はそのまま） */
      let pendingRebuild = false;
      function rebuildIfNeeded(){
        if (busy){ pendingRebuild = true; return; }   // 動きの途中なら終わってから
        const next = calcBookSize();
        if (next.w === bookSize.w && next.h === bookSize.h) return;
        const cur = curIdx();
        bookSize = next;
        applyBookSize(bookSize);
        try{ pageFlip.destroy(); }catch(e){}
        pageFlip = null;
        createBook(cur);
      }
      let resizeTimer = null;
      function scheduleRebuild(){
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(rebuildIfNeeded, 200);
      }
      window.addEventListener("resize", scheduleRebuild);
      window.addEventListener("orientationchange", scheduleRebuild);
      if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleRebuild);
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