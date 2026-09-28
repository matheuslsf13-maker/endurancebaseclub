# shellcheck shell=bash
# Shared helpers for the agent-browser E2E scenarios. Sourced by run.sh and by every 0N_*.sh.
# Runs inside Linux (WSL on the dev machine): agent-browser 0.27 drives its own installed Chrome.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."   # repo root, whatever the caller's cwd

# Ruling 56(c): no hardcoded browser path — agent-browser uses the Chrome it installed. A caller
# that wants another binary sets AGENT_BROWSER_EXECUTABLE_PATH itself; it is only passed through.
if [ -n "${AGENT_BROWSER_EXECUTABLE_PATH:-}" ]; then export AGENT_BROWSER_EXECUTABLE_PATH; fi
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}"

APP=${APP:-http://127.0.0.1:4173}
ART=tests/e2e/artifacts
STATE=$ART/state.env
mkdir -p "$ART"

ab() { local s=$1; shift; agent-browser --session "$s" "$@"; }            # ab master click '[data-testid=x]'
tid() { printf '[data-testid="%s"]' "$1"; }
step() { echo "--- $*"; }
snap() { ab "$1" screenshot "$ART/$2.png" >/dev/null; }
# Viewport shots of a whole page, top to bottom (`screenshot --full` re-lays the page out without
# the scrollbar but crops it to the old width, so right edges look clipped — misleading at 390 px).
snap_pages() { # session name [max shots]
  local s=$1 name=$2 max=${3:-4} i=1 at_end
  ab "$s" scroll up 100000 >/dev/null
  while :; do
    snap "$s" "$name-$i"
    at_end=$(js "$s" "Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight")
    [[ "$at_end" == true || $i -ge $max ]] && break
    ab "$s" scroll down 700 >/dev/null
    ab "$s" wait 150 >/dev/null
    i=$((i + 1))
  done
  ab "$s" scroll up 100000 >/dev/null
}

fail() {
  local s=$1 shot
  shift
  shot="$ART/fail-$s-$(date +%s).png"
  echo "EXPECT FAIL [$s]: $*" >&2
  ab "$s" screenshot "$shot" >/dev/null 2>&1 || true
  echo "  screenshot: $shot · tabs: $(ab "$s" tab 2>&1 | tr '\n' ' ')" >&2
  exit 1
}

wait_tid() { ab "$1" wait "$(tid "$2")" >/dev/null || fail "$1" "never appeared: $2"; }

# agent-browser 0.27 clicks a CSS selector at its current box without scrolling it into view
# first — a button below the fold gets the click on <html>. Every scripted click goes through here.
tap() {
  local s=$1 sel=$2
  ab "$s" scrollintoview "$sel" >/dev/null || fail "$s" "cannot scroll to $sel"
  ab "$s" click "$sel" >/dev/null || fail "$s" "cannot click $sel"
}
tap_tid() { tap "$1" "$(tid "$2")"; }

expect_text() {
  local s=$1 sel=$2 want=$3 got
  got=$(ab "$s" get text "$sel") || fail "$s" "cannot read $sel"
  [[ "$got" == *"$want"* ]] || fail "$s" "'$want' not in $sel: $got"
}

# Polls until the text of `sel` contains `want` (default 30 s).
wait_text() {
  local s=$1 sel=$2 want=$3 timeout_ms=${4:-30000} waited=0 got=''
  while (( waited < timeout_ms )); do
    got=$(ab "$s" get text "$sel" 2>/dev/null || true)
    [[ "$got" == *"$want"* ]] && return 0
    sleep 0.5
    waited=$((waited + 500))
  done
  fail "$s" "timed out waiting for '$want' in $sel (last: $got)"
}

# Runs JavaScript in the page and prints its (JSON) result.
js() { local s=$1; ab "$s" eval --stdin <<<"$2"; }

# Sets an input's value the way React sees a user edit (native setter + input/change events).
# Needed for <input type=date>, whose typed value depends on the browser locale.
set_value() {
  local s=$1 sel=$2 value=$3
  js "$s" "(() => {
    const el = document.querySelector($(json "$sel"));
    if (!el) throw new Error('no element ' + $(json "$sel"));
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    setter.call(el, $(json "$value"));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  })()" >/dev/null
}

# JSON string literal of $1 (for embedding shell values in JavaScript).
json() { python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$1"; }

# Clicks the first element whose visible text contains `text` among those matching `sel`.
click_with_text() {
  local s=$1 sel=$2 text=$3 found
  found=$(js "$s" "(() => {
    const el = [...document.querySelectorAll($(json "$sel"))].find(e => e.innerText.includes($(json "$text")));
    if (!el) return false;
    el.setAttribute('data-e2e-target', '1');
    return true;
  })()")
  [[ "$found" == true ]] || fail "$s" "no $sel with text '$text'"
  tap "$s" '[data-e2e-target="1"]'
  js "$s" "document.querySelector('[data-e2e-target]')?.removeAttribute('data-e2e-target')" >/dev/null
}

# Clicks the n-th (0-based) element matching `sel`.
tap_nth() {
  local s=$1 sel=$2 n=$3 found
  found=$(js "$s" "(() => {
    const el = document.querySelectorAll($(json "$sel"))[$n];
    if (!el) return false;
    el.setAttribute('data-e2e-target', '1');
    return true;
  })()")
  [[ "$found" == true ]] || fail "$s" "no element #$n for $sel"
  tap "$s" '[data-e2e-target="1"]'
  js "$s" "document.querySelector('[data-e2e-target]')?.removeAttribute('data-e2e-target')" >/dev/null
}

# Selects the <option> whose label is `label` in the <select> matching `sel`.
select_label() {
  local s=$1 sel=$2 label=$3 value
  value=$(js_str "$s" "(() => {
    const opt = [...(document.querySelector($(json "$sel"))?.options ?? [])].find(o => o.text.trim() === $(json "$label"));
    return opt ? opt.value : null;
  })()")
  [[ "$value" != null ]] || fail "$s" "no option '$label' in $sel"
  ab "$s" select "$sel" "$value" >/dev/null || fail "$s" "cannot select '$label' in $sel"
}

# Picks `name` in an EntryForm athlete combobox (entry-member-<i>).
pick_member() {
  local s=$1 i=$2 name=$3
  ab "$s" fill "$(tid "entry-member-$i")" "$name" >/dev/null
  click_with_text "$s" "[data-testid^=\"entry-member-$i-option-\"]" "$name"
}

# Prints a JavaScript string result without its JSON quotes.
js_str() { js "$1" "$2" | python3 -c 'import json, sys; v = json.load(sys.stdin); print(v if isinstance(v, str) else json.dumps(v))'; }

# The page must not scroll sideways (phones: 390 px). On failure, names the elements that stick out.
no_hscroll() {
  local s=$1 where=$2 offenders
  [[ "$(js "$s" "document.documentElement.scrollWidth <= document.documentElement.clientWidth")" == true ]] && return 0
  offenders=$(js_str "$s" "(() => {
    const w = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right > w + 1) {
        let p = el.parentElement, clipped = false;
        while (p && p !== document.body) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { clipped = true; break; }
          p = p.parentElement;
        }
        // A positioned element escapes a scroller that is not its containing block (the sr-only
        // label found by this E2E), so it is reported even inside one.
        const positioned = ['absolute', 'fixed'].includes(getComputedStyle(el).position);
        if (!clipped || positioned) out.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 60) + ' right=' + Math.round(r.right));
      }
    }
    return out.slice(0, 8).join(' | ');
  })()")
  fail "$s" "page scrolls horizontally at $(js "$s" "innerWidth") px ($where): $offenders"
}

# Scenario scripts share values (links, slug, bibs) through $STATE.
save_state() { printf '%s=%q\n' "$1" "$2" >>"$STATE"; }
load_state() { if [ -f "$STATE" ]; then . "$STATE"; fi; }
