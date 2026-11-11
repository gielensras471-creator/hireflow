import assert from 'node:assert/strict'
export const observerProbe = `(() => {
 const Native = window.ResizeObserver
 window.__tableObservers = new Map()
 window.ResizeObserver = class extends Native {
  observe(target, ...args) { if(target.classList?.contains('v3-table-scroll')) window.__tableObservers.set(this,target); return super.observe(target,...args) }
  disconnect() { window.__tableObservers.delete(this); return super.disconnect() }
 }
})()`
export async function tableChecks(
  { evaluate, send, width, check, snapshot },
  prefix,
  selector = '.v3-table-scroll'
) {
  const sel = JSON.stringify(selector)
  const metrics = []
  for (const w of [1440, 1100, 390]) {
    await width(w)
    await check('window.innerWidth === ' + w, 'viewport resized')
    await check('document.documentElement.scrollWidth <= ' + w, 'no whole page overflow')
    await check('!!document.querySelector(' + sel + ')', 'table visible')
    await check(
      '(()=>{const e=document.querySelector(' +
        sel +
        ');return !!e.parentElement.querySelector(".v3-table-hint") === (e.scrollWidth>e.clientWidth+1)})()',
      'hint matches actual overflow'
    )
    const data = await evaluate(
      '(()=>{const e=document.querySelector(' +
        sel +
        ');return {width:' +
        w +
        ',page:document.documentElement.scrollWidth,client:e.clientWidth,scroll:e.scrollWidth,tabindex:e.getAttribute("tabindex"),hint:e.parentElement.querySelector(".v3-table-hint")?.textContent??null}})()'
    )
    if (w === 1440)
      assert.equal(data.hint, null, 'wide table without overflow has no misleading hint')
    metrics.push(data)
    await snapshot(prefix + '-' + w)
  }
  await check('document.querySelector(' + sel + ').hasAttribute("tabindex")', 'overflow focusable')
  await evaluate('document.querySelector(' + sel + ').focus()')
  assert.equal(await evaluate('document.activeElement===document.querySelector(' + sel + ')'), true)
  assert.ok(
    await evaluate(
      'window.__tableObservers && [...window.__tableObservers.values()].includes(document.querySelector(' +
        sel +
        '))'
    ),
    'observer probe active'
  )
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    modifiers: 8
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    modifiers: 8
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9
  })
  assert.equal(
    await evaluate('document.activeElement===document.querySelector(' + sel + ')'),
    true,
    'real Tab reaches scroll region'
  )
  const before = await evaluate('document.querySelector(' + sel + ').scrollLeft')
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39
  })
  await check('document.querySelector(' + sel + ').scrollLeft>' + before, 'real keyboard scroll')
  await snapshot(prefix + '-keyboard')
  await evaluate('(()=>{const e=document.querySelector(' + sel + ');e.scrollLeft=e.scrollWidth})()')

  await check(
    '(()=>{const e=document.querySelector(' +
      sel +
      '); e.scrollLeft=e.scrollWidth; return e.parentElement.querySelector(".v3-table-hint").textContent.includes("已到右端")})()',
    'right edge direction'
  )
  await snapshot(prefix + '-right-edge')
  metrics.push(
    await evaluate(
      '(()=>{const e=document.querySelector(' +
        sel +
        ');return {right:e.scrollLeft,client:e.clientWidth,scroll:e.scrollWidth,hint:e.parentElement.querySelector(".v3-table-hint").textContent,focus:document.activeElement===e}})()'
    )
  )
  await evaluate('document.querySelector(' + sel + ').scrollLeft=0')
  await width(1440)
  await check(
    '!document.querySelector(' + sel + ').parentElement.querySelector(".v3-table-hint")',
    'resize clears hint'
  )
  const count = await evaluate('window.__tableObservers.size')
  await evaluate('document.querySelector(' + sel + ').parentElement.hidden=true')
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await evaluate('document.querySelector(' + sel + ').parentElement.hidden=false')
  await check('document.querySelector(' + sel + ').clientWidth>0', 'table restored after hiding')
  assert.equal(
    await evaluate('window.__tableObservers.size'),
    count,
    'hiding/restoring creates no extra observers'
  )
  metrics.push({ hideRestore: true, observedViewports: count })
  return metrics
}
export async function selectedChecks({ evaluate, send, check, snapshot }) {
  for (const [i, key] of [
    'screening',
    'scheduling',
    'due',
    'feedback',
    'decision',
    'offer'
  ].entries()) {
    const selector = '[data-work="' + key + '"]'
    await evaluate('document.querySelector(' + JSON.stringify(selector) + ').focus()')
    if (i % 2) {
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: ' ',
        code: 'Space',
        windowsVirtualKeyCode: 32
      })
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: ' ',
        code: 'Space',
        windowsVirtualKeyCode: 32
      })
    } else {
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: '\r',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13
      })
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13
      })
    }
    await check(
      'document.querySelector(' +
        JSON.stringify(selector) +
        ').getAttribute("aria-pressed")==="true"',
      'keyboard selects ' + key
    )
    assert.equal(await evaluate('document.querySelectorAll("[data-work].is-selected").length'), 1)
    assert.ok(
      await evaluate(
        'document.querySelector(' + JSON.stringify(selector) + ').textContent.includes("✓ 已选中")'
      )
    )
  }
  const point = await evaluate(
    '(()=>{const r=document.querySelector("[data-work=screening]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()'
  )
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...point
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...point
  })
  await check(
    'document.querySelector("[data-work=screening]").getAttribute("aria-pressed")==="true"',
    'real mouse selection'
  )
  await snapshot('selected-primary')
  await evaluate('document.querySelector("[data-work=decision]").click()')
  await check(
    'document.querySelector("[data-work=decision]").classList.contains("is-selected")',
    'secondary selected'
  )
  await snapshot('selected-secondary')
}
