/* Encounter Coffee Beans — 本のめくり制御・サイドメニュー開閉 */
window.addEventListener("load", function(){
  fitStage();

  /* ── 本のサイズを画面に合わせて決める ──
     PCでは見開き（2ページ分）が左右余白100pxに収まり、かつ
     縦も画面内に収まる大きさを選ぶ。スマホは従来どおり固定サイズ。 */
  const BOOK_BASE_W = 340, BOOK_BASE_H = 460;
  function calcBookSize(){
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (vw < 900) return { w: BOOK_BASE_W, h: BOOK_BASE_H };

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
      const pageFlip = new St.PageFlip(document.getElementById("book"), {
        width: bookSize.w,
        height: bookSize.h,
        size: "fixed",
        showCover: true,
        mobileScrollSupport: false,
        showPageCorners: false,     /* ホバーでの角めくり・影を無効化 */
        maxShadowOpacity: .3,       /* 影を薄くして描画負荷を下げる */
        flippingTime: 600           /* 短めにして引っかかりを減らす */
      });
      pageFlip.loadFromHTML(document.querySelectorAll(".page"));
      document.getElementById("total").textContent = pageFlip.getPageCount();
      pageFlip.on("flip", e => {
        document.getElementById("current").textContent = e.data + 1;
        updateNav(e.data);
      });
      /* 連打ガード：めくりアニメーション中は次の命令を受け付けない
         （アニメ中の割り込みが表示崩れ＝ズーム状態の原因になるため） */
      let flipLock = false;
      let lockTimer = null;
      function acquireLock(){
        if (flipLock) return false;
        flipLock = true;
        clearTimeout(lockTimer);
        lockTimer = setTimeout(() => { flipLock = false; }, 800);  // 保険の自動解除
        return true;
      }
      pageFlip.on("changeState", (e) => {
        const flipping = (e.data !== "read");
        /* めくり中は重い背景描画を止める（02-book.css の .is-flipping） */
        if (bookWrap) bookWrap.classList.toggle("is-flipping", flipping);
        if (!flipping){                    // アニメ完了＝待機状態に戻ったら解除
          flipLock = false;
          clearTimeout(lockTimer);
        }
      });
      function goPrev(){
        if (!acquireLock()) return;
        try{ pageFlip.flipPrev(); }
        catch(e){ try{ pageFlip.turnToPrevPage(); }catch(e2){} }
      }
      function goNext(){
        if (!acquireLock()) return;
        try{ pageFlip.flipNext(); }
        catch(e){ try{ pageFlip.turnToNextPage(); }catch(e2){} }
      }
      const prevBtn = document.getElementById("prev");
      const nextBtn = document.getElementById("next");
      const tapPrevBtn = document.getElementById("tapPrev");
      const tapNextBtn = document.getElementById("tapNext");
      prevBtn.addEventListener("click", goPrev);
      nextBtn.addEventListener("click", goNext);
      tapPrevBtn.addEventListener("click", goPrev);
      tapNextBtn.addEventListener("click", goNext);

      /* 始端・終端では該当ボタンを無効化 */
      function updateNav(idx){
        const last = pageFlip.getPageCount() - 1;
        const atStart = idx <= 0;
        const atEnd   = idx >= last;
        prevBtn.disabled = atStart; tapPrevBtn.disabled = atStart;
        nextBtn.disabled = atEnd;   tapNextBtn.disabled = atEnd;
        /* 最終ページでは見開きの右側を無くし、実ページを左に寄せる */
        if (bookWrap) bookWrap.classList.toggle("at-end", atEnd);
      }
      updateNav(0);

      /* ピンチズーム等で表示倍率が変わった際、本の内部座標を再計算
         （これをしないとズーム後のめくり動作が崩れる） */
      function refreshBook(){
        try{
          updateNav(pageFlip.getCurrentPageIndex());
        }catch(e){ /* 未対応環境では何もしない */ }
      }
      /* ウィンドウ幅・高さが変わったら本のサイズを作り直す
         （PC⇔スマホの切り替えや、ウィンドウのリサイズに追従） */
      function rebuildIfNeeded(){
        const next = calcBookSize();
        if (next.w === bookSize.w && next.h === bookSize.h) return;
        const cur = pageFlip.getCurrentPageIndex();
        bookSize = next;
        applyBookSize(bookSize);
        try{
          pageFlip.update({ width: bookSize.w, height: bookSize.h, size: "fixed" });
          pageFlip.turnToPage(cur);
          updateNav(cur);
        }catch(e){ /* 失敗しても表示は維持される */ }
      }
      let zoomTimer = null;
      function scheduleRefresh(){
        clearTimeout(zoomTimer);
        zoomTimer = setTimeout(() => { rebuildIfNeeded(); refreshBook(); }, 250);
      }
      if (window.visualViewport){
        window.visualViewport.addEventListener("resize", scheduleRefresh);
        window.visualViewport.addEventListener("scroll", scheduleRefresh);
      }
      window.addEventListener("resize", scheduleRefresh);
      window.addEventListener("orientationchange", scheduleRefresh);

      /* 目次リンク：指定ページへめくって移動（連打ガード共用） */
      document.querySelectorAll(".toc-link").forEach(a => {
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          const n = parseInt(a.dataset.page, 10);
          if (!acquireLock()) return;
          try{ pageFlip.flip(n); }
          catch(e){ try{ pageFlip.turnToPage(n); }catch(e2){} }
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