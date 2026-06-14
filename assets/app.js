/* James Perenchio — portfolio interactions.
   Theme toggle, sticky-nav state, scroll reveals, animated counters,
   project search/filter, and the mobile menu. Vanilla, no dependencies. */
(function () {
  "use strict";
  var doc = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Theme toggle (initial theme is set inline in <head>) ---- */
  function setTheme(t) {
    doc.setAttribute("data-theme", t);
    try { localStorage.setItem("theme", t); } catch (e) {}
    var btn = document.querySelector(".theme-toggle");
    if (btn) btn.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest(".theme-toggle");
    if (t) setTheme(doc.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  /* ---- Mobile menu ---- */
  var burger = document.querySelector(".nav-burger");
  var links = document.querySelector(".nav-links");
  if (burger && links) {
    burger.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) links.classList.remove("open");
    });
  }

  /* ---- Sticky nav shadow on scroll ---- */
  var nav = document.querySelector(".site-nav");
  function onScroll() {
    if (nav) nav.classList.toggle("scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---- Scroll reveal ---- */
  var reveals = [].slice.call(document.querySelectorAll(".reveal"));
  if (reduce || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
    // Safety net: never leave a .reveal stuck hidden if it's already on screen.
    window.addEventListener("load", function () {
      reveals.forEach(function (el) {
        if (!el.classList.contains("in") && el.getBoundingClientRect().top < window.innerHeight) {
          el.classList.add("in");
        }
      });
    });
  }

  /* ---- Animated stat counters ---- */
  function animateCount(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    if (isNaN(target)) return;
    var suffix = el.getAttribute("data-suffix") || "";
    if (reduce) { el.textContent = target.toLocaleString() + suffix; return; }
    var dur = 1100, start = performance.now();
    function step(now) {
      var p = Math.min((now - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString() + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var counters = [].slice.call(document.querySelectorAll("[data-count]"));
  if (counters.length) {
    if (!("IntersectionObserver" in window)) {
      counters.forEach(animateCount);
    } else {
      var co = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { animateCount(en.target); co.unobserve(en.target); }
        });
      }, { threshold: 0.4 });
      counters.forEach(function (el) { co.observe(el); });
    }
  }

  /* ---- Projects search + filter ---- */
  var search = document.querySelector("[data-search]");
  var grid = document.querySelector("[data-grid]");
  var empty = document.querySelector("[data-empty]");
  var chips = [].slice.call(document.querySelectorAll(".chip"));
  if (grid) {
    var items = [].slice.call(grid.querySelectorAll("[data-card]"));
    var activeFilter = "all";
    function apply() {
      var q = (search && search.value || "").trim().toLowerCase();
      var shown = 0;
      items.forEach(function (el) {
        var hay = el.getAttribute("data-search-text") || "";
        var tags = el.getAttribute("data-tags") || "";
        var okText = !q || hay.indexOf(q) !== -1;
        var okFilter = activeFilter === "all" || tags.indexOf("|" + activeFilter + "|") !== -1;
        var show = okText && okFilter;
        el.style.display = show ? "" : "none";
        if (show) shown++;
      });
      if (empty) empty.style.display = shown ? "none" : "block";
    }
    if (search) search.addEventListener("input", apply);
    chips.forEach(function (c) {
      c.addEventListener("click", function () {
        chips.forEach(function (x) { x.classList.remove("active"); });
        c.classList.add("active");
        activeFilter = c.getAttribute("data-filter") || "all";
        apply();
      });
    });
  }

  /* ---- Footer year ---- */
  var y = document.querySelector("[data-year]");
  if (y) y.textContent = new Date().getFullYear();
})();
