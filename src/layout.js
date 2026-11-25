/* Composer geometry and overlap protection; no requests or stored settings. */
(function (root) {
  "use strict";
  function create(provider, schedule) {
    var codexComposer = '[data-codex-composer-root], [data-composer-surface-variant], #composer-background, form[data-chatgpt-composer], form[data-type="unified-composer"]';
    function isNonChatPage() {
      return provider === "codex" && (/^\/(?:codex\/)?settings(?:\/|$)/i.test(location.pathname) ||
        /^#settings(?:[\/=?]|$)/i.test(location.hash));
    }
    // Prefer the message composer over search, settings and source-code editors.
    function findEditable() {
      if (isNonChatPage()) return null;
      var candidates = document.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"], textarea');
      var best = null, bestScore = -Infinity;
      for (var i = 0; i < candidates.length; i++) {
        var editable = candidates[i];
        // Settings and GPT editors also contain textareas; geometry and generic
        // labels alone do not establish a ChatGPT message composer.
        if (provider === "codex" && !editable.matches('#prompt-textarea') && !editable.closest(codexComposer)) continue;
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
        ? codexComposer
        : provider === "gemini" ? 'input-area-v2, .input-area-container, .input-area-fieldset'
        : '[data-testid="chat-input-container"], [data-testid="composer"]';
      // In Work mode the environment toolbar is a sibling of the input card.
      var known = provider === "codex" && editable.closest("[data-codex-composer-root]");
      if (!known || !known.getClientRects().length) known = editable.closest(selectors);
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

    var composerObserver = null, observedEditor = null, observedBoundary = null, observedToggle = null;
    var greetingAdjustment = null;
    var greetingAnim = null;
    var lastPlaced = null;
    var cachedComposerHeight = 0;

    function motionAllowed() {
      try {
        return typeof window.matchMedia === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch (_) { return false; }
    }

    function cancelGreetingAnim() {
      if (!greetingAnim) return;
      try { greetingAnim.cancel(); } catch (_) {}
      greetingAnim = null;
    }

    function animateGreeting(node, fromTranslate, toTranslate) {
      cancelGreetingAnim();
      if (!motionAllowed() || typeof node.animate !== "function" || fromTranslate === toTranslate) return;
      try {
        var anim = node.animate(
          [{ translate: fromTranslate || "0 0" }, { translate: toTranslate || "0 0" }],
          { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        );
        greetingAnim = anim;
        var clear = function () { if (greetingAnim === anim) greetingAnim = null; };
        anim.onfinish = clear;
        anim.oncancel = clear;
      } catch (_) {}
    }

    function restoreGreeting(animate) {
      cancelGreetingAnim();
      if (!greetingAdjustment) return;
      var saved = greetingAdjustment;
      var currentVal = saved.node.style.getPropertyValue("translate");
      // Only restore if the host page has not overwritten our applied translate.
      if (currentVal === saved.applied) {
        if (saved.value) saved.node.style.setProperty("translate", saved.value, saved.priority);
        else saved.node.style.removeProperty("translate");
        if (animate && saved.node.isConnected) animateGreeting(saved.node, currentVal, saved.value || "0 0");
      }
      greetingAdjustment = null;
    }

    // The centered ChatGPT start screen has a heading immediately above its
    // composer. Move only that greeting enough to leave an 8px visual gap;
    // never move conversation headings or change the editor's layout.
    function makeRoomForGreeting(top, left, width, composerTop) {
      if (provider !== "codex" || !/^\/(?:$|new\/?$)/.test(location.pathname)) {
        restoreGreeting(true);
        return;
      }
      if (greetingAdjustment && greetingAdjustment.node.isConnected &&
          greetingAdjustment.top === top && greetingAdjustment.left === left &&
          greetingAdjustment.width === width && greetingAdjustment.composerTop === composerTop &&
          greetingAdjustment.path === location.pathname &&
          greetingAdjustment.node.getBoundingClientRect().height === greetingAdjustment.headingHeight) {
        return;
      }
      var prevNode = greetingAdjustment ? greetingAdjustment.node : null;
      var prevShift = greetingAdjustment ? greetingAdjustment.shift : 0;
      var prevOriginalValue = greetingAdjustment ? greetingAdjustment.value : "";
      restoreGreeting(false);
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
        var nextValue = "0 -" + shift + "px";
        var originalValue = heading.style.getPropertyValue("translate");
        var originalPriority = heading.style.getPropertyPriority("translate");
        heading.style.setProperty("translate", nextValue);
        greetingAdjustment = {
          node: heading,
          value: originalValue,
          priority: originalPriority,
          applied: heading.style.getPropertyValue("translate"),
          shift: shift,
          headingHeight: box.height,
          top: top,
          left: left,
          width: width,
          composerTop: composerTop,
          path: location.pathname
        };
        if (prevNode === heading) {
          if (prevShift !== shift) animateGreeting(heading, prevShift ? "0 -" + prevShift + "px" : prevOriginalValue, nextValue);
        } else {
          animateGreeting(heading, greetingAdjustment.value, nextValue);
        }
        return;
      }
      if (prevNode && prevNode.isConnected && prevShift) {
        animateGreeting(prevNode, "0 -" + prevShift + "px", prevOriginalValue);
      }
    }
    function observeComposer(editable, boundary, toggle = null) {
      if (editable === observedEditor && boundary === observedBoundary && toggle === observedToggle) return;
      if (composerObserver) composerObserver.disconnect();
      observedEditor = editable; observedBoundary = boundary; observedToggle = toggle;
      if (!editable || typeof ResizeObserver === "undefined") return;
      if (!composerObserver) composerObserver = new ResizeObserver(schedule);
      composerObserver.observe(editable);
      if (boundary && boundary !== editable) composerObserver.observe(boundary);
      if (toggle) composerObserver.observe(toggle);
    }

    function affectsAnchor(scrollTarget) {
      if (!scrollTarget || scrollTarget === document || scrollTarget === document.documentElement || scrollTarget === document.body) return true;
      if (observedBoundary && typeof scrollTarget.contains === "function" && scrollTarget.contains(observedBoundary)) return true;
      if (observedEditor && typeof scrollTarget.contains === "function" && scrollTarget.contains(observedEditor)) return true;
      return false;
    }

    function setStyleProp(el, prop, value) {
      if (value == null || value === "") {
        if (el.style.getPropertyValue(prop)) el.style.removeProperty(prop);
      } else if (el.style.getPropertyValue(prop) !== value) {
        el.style.setProperty(prop, value);
      }
    }

    function placeBar(barEl, editable, collapsed) {
      var boundary = editable ? composerBoundary(editable) : null;
      var area = provider === "gemini" && editable && editable.closest(".input-area-container");
      var toggle = area ? area.querySelector("chat-spark-toggle") : null;
      observeComposer(editable, boundary, toggle);
      var wasComposer = barEl.classList.contains("cum-composer");
      var hadPlacement = lastPlaced && lastPlaced.barEl === barEl;
      var isComposer = false;
      var targetBox = null;

      if (boundary) {
        var rect = boundary.getBoundingClientRect();
        var vpW = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
        var vpH = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
        var width = Math.min(rect.width, vpW - 32);
        var anchorTop = rect.top;
        if (toggle && getComputedStyle(toggle).visibility !== "hidden") {
          var toggleBox = toggle.getBoundingClientRect();
          if (toggleBox.height && toggleBox.right > rect.left && toggleBox.left < rect.right) anchorTop = Math.min(anchorTop, toggleBox.top);
        }
        // Avoid adding then immediately stripping composer classes when clearly out of room.
        var clearlyNoRoom = rect.top >= vpH || rect.bottom <= 0 ||
          (!wasComposer && cachedComposerHeight > 0 && anchorTop - cachedComposerHeight - 6 < 16);
        if (!clearlyNoRoom) {
          var narrow = width < 520;
          var compact = width < 760;
          barEl.classList.add("cum-composer");
          barEl.classList.toggle("cum-narrow", narrow);
          barEl.classList.toggle("cum-compact", compact);
          setStyleProp(barEl, "width", collapsed ? "" : width + "px");
          var rawBox = barEl.offsetWidth && barEl.offsetHeight
            ? { width: barEl.offsetWidth, height: barEl.offsetHeight }
            : barEl.getBoundingClientRect();
          var size = { width: rawBox.width, height: rawBox.height };
          if (!collapsed && size.height > 0) cachedComposerHeight = size.height;
          var top = anchorTop - size.height - 6;
          // Retain the corner dock if scrolling/expansion leaves no room above.
          if (top >= 16 && rect.top < vpH && rect.bottom > 0) {
            var left = Math.max(16, Math.min(rect.right - size.width, vpW - size.width - 16));
            setStyleProp(barEl, "top", top + "px");
            setStyleProp(barEl, "left", left + "px");
            setStyleProp(barEl, "right", "auto");
            makeRoomForGreeting(top, left, size.width, rect.top);
            isComposer = true;
            targetBox = { left: left, top: top, right: left + size.width, bottom: top + size.height };
          } else {
            barEl.classList.remove("cum-composer", "cum-narrow", "cum-compact");
            setStyleProp(barEl, "top", "");
            setStyleProp(barEl, "left", "");
            setStyleProp(barEl, "right", "");
            setStyleProp(barEl, "width", "");
            restoreGreeting(true);
          }
        } else {
          barEl.classList.remove("cum-composer", "cum-narrow", "cum-compact");
          setStyleProp(barEl, "top", "");
          setStyleProp(barEl, "left", "");
          setStyleProp(barEl, "right", "");
          setStyleProp(barEl, "width", "");
          restoreGreeting(true);
        }
      } else {
        barEl.classList.remove("cum-composer", "cum-narrow", "cum-compact");
        setStyleProp(barEl, "top", "");
        setStyleProp(barEl, "left", "");
        setStyleProp(barEl, "right", "");
        setStyleProp(barEl, "width", "");
        restoreGreeting(true);
      }

      if (hadPlacement && wasComposer !== isComposer && motionAllowed() && typeof barEl.animate === "function") {
        try {
          barEl.animate(
            [{ opacity: 0.72 }, { opacity: 1 }],
            { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
          );
        } catch (_) {}
      }
      lastPlaced = { barEl: barEl, isComposer: isComposer };
      protectEditor(barEl, boundary, toggle, targetBox);
    }

    // If a resized/expanded editor reaches the dock, temporarily hide the meter.
    // Visibility preserves its dimensions so it can reappear when space returns.
    function protectEditor(barEl, boundary, toggle, targetBox) {
      var overlaps = false;
      var bar = targetBox || barEl.getBoundingClientRect();
      var editors = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="dialog"], [aria-modal="true"]'));
      if (boundary) editors.push(boundary);
      if (toggle) editors.push(toggle);
      for (var i = 0; i < editors.length; i++) {
        var editor = editors[i];
        if (!editor.getClientRects().length || getComputedStyle(editor).visibility === "hidden") continue;
        var rect = visibleEditorRect(editor);
        if (!rect.width || !rect.height) continue;
        if (bar.left < rect.right + 4 && bar.right > rect.left - 4 && bar.top < rect.bottom + 4 && bar.bottom > rect.top - 4) {
          overlaps = true; break;
        }
      }
      barEl.classList.toggle("cum-obscured", overlaps);
      if ("inert" in barEl) barEl.inert = overlaps;
      setStyleProp(barEl, "visibility", overlaps ? "hidden" : "");
    }

    return { findEditable: findEditable, composerBoundary: composerBoundary,
      placeBar: placeBar, restoreGreeting: restoreGreeting, observeComposer: observeComposer,
      affectsAnchor: affectsAnchor };
  }
  root.UsageLayout = { create: create };
})(globalThis);
