/* Composer geometry and overlap protection; no requests or stored settings. */
(function (root) {
  "use strict";
  function create(provider, schedule) {
    // Prefer the message composer over search, settings and source-code editors.
    function findEditable() {
      var candidates = document.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"], textarea');
      var best = null, bestScore = -Infinity;
      for (var i = 0; i < candidates.length; i++) {
        var editable = candidates[i];
        if (editable.closest('[role="dialog"], [aria-modal="true"], [role="search"], .monaco-editor, .cm-editor, nav') ||
            editable.disabled || editable.readOnly || !editable.getClientRects().length) continue;
        var style = getComputedStyle(editable);
        if (style.visibility === "hidden" || style.display === "none") continue;
        var rect = visibleEditorRect(editable);
        if (rect.width < 100 || rect.height < 20 || rect.bottom <= 0 || rect.top >= window.innerHeight ||
            rect.right <= 0 || rect.left >= window.innerWidth) continue;
        var hint = [editable.id, editable.getAttribute("data-testid"), editable.getAttribute("aria-label"), editable.getAttribute("placeholder")].join(" ");
        var score = rect.bottom / window.innerHeight;
        if (editable.matches('#prompt-textarea, [data-composer-markdown], .ql-editor[contenteditable="true"]') || editable.closest('rich-textarea')) score += 20;
        if (/prompt|composer|message|reply|消息|回复/i.test(hint)) score += 10;
        if (editable.closest("form, fieldset")) score += 2;
        if (score > bestScore) { best = editable; bestScore = score; }
      }
      return best;
    }

    // Long drafts extend beyond their scrolling viewport. Only their visible
    // part can obscure the meter, or qualify them as an on-screen composer.
    function visibleEditorRect(editable) {
      var box = editable.getBoundingClientRect();
      var rect = { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      for (var parent = editable.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        var style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(style.overflowY || style.overflow)) {
          rect.top = Math.max(rect.top, clip.top); rect.bottom = Math.min(rect.bottom, clip.bottom);
        }
        if (/auto|scroll|hidden|clip/.test(style.overflowX || style.overflow)) {
          rect.left = Math.max(rect.left, clip.left); rect.right = Math.min(rect.right, clip.right);
        }
      }
      rect.width = Math.max(0, rect.right - rect.left); rect.height = Math.max(0, rect.bottom - rect.top);
      return rect;
    }

    // Anchor to the entire composer, including files and controls. Comparing
    // its height with the editable fails both for tall attachments and for
    // long drafts clipped by an inner scrolling wrapper.
    function composerBoundary(editable) {
      var selectors = provider === "codex"
        ? '[data-composer-surface-variant], #composer-background, form[data-chatgpt-composer], form[data-type="unified-composer"]'
        : provider === "gemini" ? 'input-area-v2, .input-area-container, .input-area-fieldset'
        : '[data-testid="chat-input-container"], [data-testid="composer"]';
      var known = editable.closest(selectors);
      if (known && known !== editable) {
        var knownBox = known.getBoundingClientRect();
        if (knownBox.width && knownBox.height) return known;
      }
      var rect = visibleEditorRect(editable);
      var parent = editable.parentElement;
      for (var depth = 0; parent && parent !== document.body && depth < 16; depth++, parent = parent.parentElement) {
        if (parent.matches('main, article, [role="main"]') ||
            parent.querySelector('[data-message-author-role], [data-testid="user-message"], [data-testid="assistant-message"], user-query, model-response')) break;
        var box = parent.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        if (box.width > rect.width + 440) break;
        var style = getComputedStyle(parent);
        // Stop at the nearest input card; outer forms may include the thread.
        if (parent.matches("form, fieldset") || parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderRadius) > 0) return parent;
      }
      return editable;
    }

    var composerObserver = null, observedEditor = null, observedBoundary = null;
    var greetingAdjustment = null;
    function restoreGreeting() {
      if (!greetingAdjustment) return;
      var saved = greetingAdjustment;
      if (saved.value) saved.node.style.setProperty("translate", saved.value, saved.priority);
      else saved.node.style.removeProperty("translate");
      greetingAdjustment = null;
    }

    // The centered ChatGPT start screen has a heading immediately above its
    // composer. Move only that greeting enough to leave an 8px visual gap;
    // never move conversation headings or change the editor's layout.
    function makeRoomForGreeting(top, left, width, composerTop) {
      if (provider !== "codex" || !/^\/(?:$|new\/?$)/.test(location.pathname)) return;
      // ChatGPT's current home shell has no <main>; use semantic headings
      // with route, region and proximity guards rather than a main ancestor.
      var headings = document.querySelectorAll('h1, h2, [role="heading"]');
      for (var i = 0; i < headings.length; i++) {
        var heading = headings[i], box = heading.getBoundingClientRect();
        if (heading.closest('nav, aside, header, [role="navigation"], [role="dialog"], [aria-modal="true"], [data-message-author-role]') ||
            !heading.getClientRects().length || getComputedStyle(heading).visibility === "hidden" ||
            box.bottom > composerTop || box.bottom < composerTop - 180 ||
            box.right <= left || box.left >= left + width) continue;
        var shift = Math.max(0, box.bottom + 8 - top);
        if (!shift || box.top - shift < 16) continue;
        greetingAdjustment = { node: heading, value: heading.style.getPropertyValue("translate"), priority: heading.style.getPropertyPriority("translate") };
        heading.style.setProperty("translate", "0 -" + shift + "px", "important");
        break;
      }
    }
    function observeComposer(editable, boundary) {
      if (editable === observedEditor && boundary === observedBoundary) return;
      if (composerObserver) composerObserver.disconnect();
      observedEditor = editable; observedBoundary = boundary;
      if (!editable || typeof ResizeObserver === "undefined") return;
      if (!composerObserver) composerObserver = new ResizeObserver(schedule);
      composerObserver.observe(editable);
      if (boundary && boundary !== editable) composerObserver.observe(boundary);
    }

    function placeBar(barEl, editable, collapsed) {
      var boundary = editable ? composerBoundary(editable) : null;
      observeComposer(editable, boundary);
      barEl.classList.remove("cum-composer", "cum-narrow");
      ["top", "left", "right", "width"].forEach(function (key) { barEl.style.removeProperty(key); });
      if (boundary) {
        var rect = boundary.getBoundingClientRect();
        var width = Math.min(rect.width, window.innerWidth - 32);
        barEl.classList.add("cum-composer");
        barEl.classList.toggle("cum-narrow", width < 600);
        if (!collapsed) barEl.style.width = width + "px";
        var size = barEl.getBoundingClientRect();
        var top = rect.top - size.height - 6;
        // Retain the corner dock if scrolling/expansion leaves no room above.
        if (top >= 16 && rect.top < window.innerHeight && rect.bottom > 0) {
          barEl.style.top = top + "px";
          barEl.style.left = Math.max(16, Math.min(rect.right - size.width, window.innerWidth - size.width - 16)) + "px";
          barEl.style.right = "auto";
          makeRoomForGreeting(top, parseFloat(barEl.style.left), size.width, rect.top);
        } else {
          barEl.classList.remove("cum-composer", "cum-narrow");
          barEl.style.removeProperty("width");
        }
      }
      protectEditor(barEl, boundary);
    }

    // If a resized/expanded editor reaches the dock, temporarily hide the meter.
    // Visibility preserves its dimensions so it can reappear when space returns.
    function protectEditor(barEl, boundary) {
      var overlaps = false;
      var bar = barEl.getBoundingClientRect();
      var editors = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="dialog"], [aria-modal="true"]'));
      if (boundary) editors.push(boundary);
      for (var i = 0; i < editors.length; i++) {
        var editor = editors[i];
        if (!editor.getClientRects().length || getComputedStyle(editor).visibility === "hidden") continue;
        var rect = visibleEditorRect(editor);
        if (!rect.width || !rect.height) continue;
        if (bar.left < rect.right + 4 && bar.right > rect.left - 4 && bar.top < rect.bottom + 4 && bar.bottom > rect.top - 4) {
          overlaps = true; break;
        }
      }
      barEl.style.visibility = overlaps ? "hidden" : "";
    }

    return { findEditable: findEditable, composerBoundary: composerBoundary,
      placeBar: placeBar, restoreGreeting: restoreGreeting, observeComposer: observeComposer };
  }
  root.UsageLayout = { create: create };
})(globalThis);
