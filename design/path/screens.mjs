// The screen templates and the scheme helpers every flow page is built from.
// A text change here lands in every scheme at once.

const INK = '#18181B', MUTED = '#71717A', BODY = '#3F3F46', LINE = '#D4D4D8', SOFT = '#F4F4F5', HAIR = '#E4E4E7';
const PH = 'background: repeating-linear-gradient(135deg, #E4E4E7 0 6px, #F4F4F5 6px 12px);';

const btn = (label, kind = 'primary') =>
  kind === 'primary'
    ? `<div style="height: 52px; border-radius: 12px; background: ${INK}; color: #FFFFFF; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 600;">${label}</div>`
    : kind === 'outline'
      ? `<div style="height: 52px; border-radius: 12px; border: 1px solid ${INK}; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 600;">${label}</div>`
      : kind === 'disabled'
        ? `<div style="height: 52px; border-radius: 12px; background: ${HAIR}; color: #A1A1AA; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 600;">${label}</div>`
        : `<div style="height: 44px; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #52525B;">${label}</div>`;
const badge = (net, long = false) =>
  net === 'testnet'
    ? `<div style="font-size: 11px; font-weight: 600; letter-spacing: 0.04em; padding: 4px 8px; border-radius: 6px; border: 1px solid ${LINE}; color: #52525B;">${long ? 'TESTNET · TEST MONEY' : 'TESTNET'}</div>`
    : '';
const h1 = (t) => `<div style="font-size: 28px; line-height: 1.15; font-weight: 700; letter-spacing: -0.01em;">${t}</div>`;
const p = (t) => `<div style="font-size: 16px; line-height: 1.45; color: #52525B; text-wrap: pretty;">${t}</div>`;
const small = (t) => `<div style="font-size: 13px; color: ${MUTED};">${t}</div>`;
const card = (inner, extra = '') => `<div style="display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: 14px; background: ${SOFT}; ${extra}">${inner}</div>`;
const row = (a, b) => `<div style="display: flex; justify-content: space-between; font-size: 14px; color: ${BODY};"><div>${a}</div><div style="font-weight: 600; font-variant-numeric: tabular-nums;">${b}</div></div>`;
const MONAD = (c) => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"><path d="M12 2l9 5v10l-9 5-9-5V7z"></path></svg>`;
const term = (t) => `<span style="border-bottom: 1px dashed #A1A1AA;">${t}</span>`;

/** A screen: top-aligned column between the safe areas, main action pinned to the bottom. */
const page = (top, bottom = '', pad = '72px 24px 32px') =>
  `<div style="flex: 1; display: flex; flex-direction: column; justify-content: space-between; padding: ${pad}; box-sizing: border-box; gap: 16px;"><div style="display: flex; flex-direction: column; gap: 20px;">${top}</div>${bottom ? `<div style="display: flex; flex-direction: column; gap: 12px;">${bottom}</div>` : ''}</div>`;

const header = (title, net, right = '') =>
  `<div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 15px; font-weight: 600;">${title}</div>${badge(net)}${right ? `<div style="margin-left: auto;">${right}</div>` : ''}</div>`;

const strategyCard = (name, sub, line, lead) =>
  `<div style="display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 14px; border: ${lead ? `2px solid ${INK}` : `1px solid ${HAIR}`}; background: #FAFAFA;">
    <div style="display: flex; align-items: center; gap: 10px;"><div style="width: 56px; height: 56px; border-radius: 12px; ${PH}"></div><div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 17px; font-weight: 700;">${name}</div>${small(sub)}</div>${lead ? `<div style="margin-left: auto; font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 6px; background: ${INK}; color: #FFFFFF;">START HERE</div>` : ''}</div>
    <div style="font-size: 14px; line-height: 1.4; color: ${BODY};">${line}</div>
  </div>`;

const S = {
  splash: () => `<div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; background: ${INK}; color: #FFFFFF;"><div style="width: 72px; height: 72px; border-radius: 20px; background: #FFFFFF;"></div><div style="font-size: 22px; font-weight: 700;">TradeAgent</div><div style="width: 120px; height: 3px; border-radius: 2px; background: #3F3F46; overflow: hidden;"><div style="height: 3px; width: 60%; background: #FFFFFF;"></div></div><div style="position: absolute; bottom: 40px; font-size: 12px; color: #A1A1AA;">logo animation · 1.5 s</div></div>`,

  network: () => page(
    `${h1('How do you want to start?')}
     <div style="display: flex; flex-direction: column; gap: 8px; padding: 18px 16px; border-radius: 16px; border: 2px solid ${INK}; background: #FAFAFA;"><div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 19px; font-weight: 700;">Practice</div><div style="margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; padding: 4px 8px; border-radius: 6px; border: 1px solid ${LINE}; color: #52525B;">${MONAD('#52525B')}MONAD TESTNET</div></div><div style="font-size: 15px; line-height: 1.4; color: ${BODY};">Practice money from the exchange. Real prices, real strategies, nothing to lose.</div></div>
     <div style="display: flex; flex-direction: column; gap: 8px; padding: 18px 16px; border-radius: 16px; border: 1px solid ${LINE}; background: #FAFAFA;"><div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 19px; font-weight: 700;">Real money</div><div style="margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; padding: 4px 8px; border-radius: 6px; background: ${INK}; color: #FFFFFF;">${MONAD('#FFFFFF')}MONAD MAINNET</div></div><div style="font-size: 15px; line-height: 1.4; color: ${BODY};">Your own money on a real exchange. You deposit it, every win and loss is real, and you can withdraw any time.</div></div>`,
    `<div style="font-size: 13px; color: ${MUTED}; text-align: center;">You can switch any time in Account.</div>`),

  intro: (net, i = 0) => {
    const slides = [
      ['Be the smartest one in the market', 'Join the 0.01% who trade with AI and real strategies. Everyone else is at the casino.'],
      ['Your trading copilot', 'Not a wealth button. A tool that makes you a sharper trader: strategies to follow, then your own to build, skills that compound.'],
      ['This is where you get good', 'A plan on every trade, a stop, a daily budget. A streak to protect, a board to climb. Discipline you can feel in a week.'],
    ];
    return page(
      `<div style="display: flex; align-items: center; justify-content: space-between;"><div style="display: flex; align-items: center; gap: 8px;"><div style="width: 22px; height: 22px; border-radius: 6px; background: ${INK};"></div><div style="font-size: 14px; font-weight: 600;">TradeAgent</div>${badge(net)}</div><div style="font-size: 14px; color: ${MUTED};">Skip</div></div>
       <div style="height: 260px; border-radius: 20px; ${PH}"></div>
       <div style="display: flex; gap: 6px;">${[0, 1, 2].map((k) => `<div style="width: 24px; height: 4px; border-radius: 2px; background: ${k <= i ? INK : HAIR};"></div>`).join('')}</div>
       <div style="font-size: 30px; line-height: 1.1; font-weight: 700; letter-spacing: -0.01em; text-wrap: pretty;">${slides[i][0]}</div>
       <div style="font-size: 17px; line-height: 1.45; color: ${BODY}; text-wrap: pretty;">${slides[i][1]}</div>`,
      btn(i < 2 ? 'Next' : "Let's go"), '60px 24px 32px');
  },

  promo: (net) => page(
    `<div style="display: flex; align-items: center; gap: 10px;"><div style="width: 28px; height: 28px; border-radius: 8px; background: ${INK};"></div><div style="font-size: 15px; font-weight: 600;">TradeAgent</div><div style="margin-left: auto;">${badge(net)}</div></div>
     <div style="height: 220px; border-radius: 16px; ${PH}"></div>
     <div style="font-size: 32px; line-height: 1.1; font-weight: 700; letter-spacing: -0.01em; text-wrap: pretty;">Up or down? One tap, fifteen minutes.</div>
     ${p('You call where Bitcoin goes next. The platform opens the trade, watches it and closes it for you.')}
     <div style="font-size: 14px; color: ${MUTED};">${net === 'testnet' ? 'Practice with test money. Nothing real is at stake.' : 'Real money. Start small.'}</div>`,
    btn('Start')),

  passkey: () => page(
    `<div style="width: 64px; height: 64px; border-radius: 16px; border: 1px solid ${LINE};"></div>
     ${h1('Your account is a passkey')}
     ${p('No password, no seed phrase. The key is created on this device and Face ID unlocks it. Nobody else, including us, can withdraw.')}`,
    btn('Create account') + btn('I already have one · Sign in', 'link')),

  dialog: (label = 'Create a passkey for TradeAgent?') =>
    `<div style="flex: 1; position: relative;">${S.passkey()}
     <div style="position: absolute; inset: 0; background: rgba(24,24,27,0.35); display: flex; align-items: flex-end; padding: 16px; box-sizing: border-box;">
       <div style="width: 100%; border-radius: 20px; background: #FFFFFF; padding: 24px 20px 16px; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; align-items: center;">
         <div style="width: 48px; height: 48px; border-radius: 12px; border: 1px solid ${LINE};"></div>
         <div style="font-size: 17px; font-weight: 600; text-align: center;">${label}</div>
         <div style="font-size: 13px; color: ${MUTED}; text-align: center;">System dialog. Face ID or your phone's unlock.</div>
         <div style="width: 100%; height: 48px; border-radius: 12px; background: ${INK}; color: #FFFFFF; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600;">Continue</div>
         <div style="font-size: 15px; color: #52525B;">Cancel</div>
       </div></div></div>`,

  realMoney: () => page(
    `${h1('This is real money')}
     ${p('Trades here use real dollars on a real exchange. A losing trade loses money. Every trade has a stop, and you never risk more than the screen says.')}
     ${card(`<div style="font-size: 14px; color: ${BODY};">· Your first trade risks at most 25 AUSD</div><div style="font-size: 14px; color: ${BODY};">· You can close any trade at any moment</div><div style="font-size: 14px; color: ${BODY};">· One button closes everything</div>`)}`,
    btn('I understand')),

  moneyPick: ({ from = 'base' } = {}) => page(
    `${h1('Add funds')}
     ${p('Already on Monad: send AUSD straight to your address. From another chain or an exchange: it arrives as AUSD over the bridge.')}
     <div style="display: flex; flex-direction: column; gap: 8px;">${small('From')}<div style="display: flex; gap: 6px; flex-wrap: wrap;">${['Monad', 'Base', 'Arbitrum', 'Ethereum'].map((c) => `<div style="padding: 10px 12px; border-radius: 10px; border: 1px solid ${c.toLowerCase() === from ? INK : LINE}; font-size: 14px; ${c.toLowerCase() === from ? 'font-weight: 600;' : 'color: #52525B;'}">${c}</div>`).join('')}</div></div>
     ${from === 'monad'
       ? `${card(`${small('Send AUSD on Monad to your address')}<div style="font-size: 15px; font-weight: 600; word-break: break-all;">0x3f9a 2c41 8b7e d0f5 6a1c 93e2 47b8 c5d1 0a4f e6b2</div><div style="display: flex; gap: 8px;"><div style="padding: 8px 12px; border-radius: 8px; border: 1px solid ${LINE}; font-size: 13px;">Copy</div><div style="padding: 8px 12px; border-radius: 8px; border: 1px solid ${LINE}; font-size: 13px;">QR</div></div>`)}${small('No bridge, no swap: it lands in a minute. Minimum 100 AUSD to open the account.')}`
       : `<div style="display: flex; flex-direction: column; gap: 8px;">${small('Asset and amount')}<div style="display: flex; gap: 8px; align-items: center;"><div style="padding: 10px 14px; border-radius: 10px; border: 1px solid ${INK}; font-size: 14px; font-weight: 600;">USDC</div><div style="padding: 10px 14px; border-radius: 10px; border: 1px solid ${LINE}; font-size: 14px; color: #52525B;">ETH</div><div style="margin-left: auto; padding: 10px 14px; border-radius: 10px; border: 1px solid ${LINE}; font-size: 16px; min-width: 80px; text-align: right;">100</div></div>${small('Minimum 100. The exchange needs it to open your account.')}</div>`}`,
    from === 'monad' ? btn('Waiting for the transfer…', 'disabled') : btn('Get address')),

  moneyWait: () => page(
    `${h1('Add funds')}
     ${card(`${small('Send 100 USDC on Base to')}<div style="font-size: 15px; font-weight: 600; word-break: break-all;">0x3f9a 2c41 8b7e d0f5 6a1c 93e2 47b8 c5d1 0a4f e6b2</div><div style="align-self: flex-start; padding: 8px 12px; border-radius: 8px; border: 1px solid ${LINE}; font-size: 13px;">Copy</div>`)}
     <div style="display: flex; align-items: center; gap: 10px; font-size: 14px; color: #52525B;"><div style="width: 10px; height: 10px; border-radius: 5px; border: 2px solid #A1A1AA;"></div><div>Waiting for your transfer. Usually under two minutes.</div></div>`,
    btn('Waiting…', 'disabled')),

  moneyDone: () => page(
    `${h1('Add funds')}
     ${card(`${small('Arrived')}<div style="font-size: 28px; font-weight: 700;">100 AUSD</div>`)}`,
    btn('Continue')),

  enable: (net) => page(
    `${h1('Open your account')}
     ${p(net === 'testnet' ? 'One tap. The exchange opens your account and gives you 10 000 AUSD of practice money. About a minute.' : 'One tap. The exchange opens your account and links it to the strategies. About a minute.')}`,
    btn('Open account')),

  enableProgress: (net) => page(
    `${h1('Open your account')}
     ${p(net === 'testnet' ? 'One tap. The exchange opens your account and gives you 10 000 AUSD of practice money. About a minute.' : 'One tap. The exchange opens your account and links it to the strategies. About a minute.')}
     ${card(`<div style="display: flex; gap: 6px;"><div style="flex: 1; height: 6px; border-radius: 3px; background: ${INK};"></div><div class="busy" style="flex: 1; height: 6px; border-radius: 3px;"></div><div style="flex: 1; height: 6px; border-radius: 3px; background: ${LINE};"></div></div><div style="display: flex; align-items: center; gap: 10px;"><div class="pulse" style="width: 10px; height: 10px; border-radius: 5px; background: ${INK};"></div><div style="font-size: 15px; font-weight: 600;">${net === 'testnet' ? 'Test money arriving: 10 000 AUSD' : 'Opening your account'}</div></div><div style="display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: ${MUTED};"><div>✓ Signed in to the exchange</div><div style="color: ${INK};">● ${net === 'testnet' ? 'Test money arriving' : 'Opening your account'} · 12 s</div><div>○ ${net === 'testnet' ? 'Opening your account' : 'Linking the strategies'}</div></div>`)}`,
    btn('Working…', 'disabled')),

  lobby: (net, returning, opts = {}) => `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 24px; box-sizing: border-box; gap: 14px; overflow: hidden;">
     ${opts.banner ? `<div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 12px; border: 2px solid ${INK}; font-size: 14px; font-weight: 600;"><div>${opts.banner}</div><div>Claim</div></div>` : ''}
     <div style="display: flex; align-items: center; gap: 10px; position: relative;"><div style="width: 28px; height: 28px; border-radius: 8px; background: #18181B;"></div><div style="display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; padding: 5px 9px; border-radius: 8px; border: 1px solid ${LINE}; color: #52525B; ${net === 'mainnet' ? `background: ${INK}; color: #FFFFFF; border-color: ${INK};` : ''}">${net === 'testnet' ? 'TESTNET' : 'MAINNET'} <span style="font-size: 9px;">▼</span></div><div style="margin-left: auto; font-size: 14px; color: #52525B;">${net === 'testnet' ? '10 000' : '100'} AUSD</div>${opts.menu ? `<div style="position: absolute; top: 36px; left: 38px; width: 250px; border-radius: 14px; background: #FFFFFF; border: 1px solid ${LINE}; box-shadow: 0 12px 30px rgba(24,24,27,0.16); padding: 6px; display: flex; flex-direction: column; gap: 2px; z-index: 2;"><div style="padding: 10px 12px; border-radius: 10px; background: ${net === 'testnet' ? SOFT : '#FFFFFF'}; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 14px; font-weight: 600;">Practice ${net === 'testnet' ? '✓' : ''}</div><div style="font-size: 12px; color: ${MUTED};">Monad testnet · practice money</div></div><div style="padding: 10px 12px; border-radius: 10px; background: ${net === 'mainnet' ? SOFT : '#FFFFFF'}; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 14px; font-weight: 600;">Real money ${net === 'mainnet' ? '✓' : ''}</div><div style="font-size: 12px; color: ${MUTED};">Monad mainnet · your own money</div></div></div>` : ''}</div>
     <div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 22px; font-weight: 700;">Choose a strategy</div>${small('Direction leads this week with +12.3 · MA Cross +2.1 · RSI −0.4')}</div>
     ${strategyCard('Direction', 'Pool 3.1 AUSD · 12 players · you #7', 'You call up or down. We close it in 15 minutes.', !returning)}
     ${strategyCard('MA Cross', 'Pool 0.3 AUSD · 4 players', 'Lights up when the trend turns. One tap.', false)}
     ${strategyCard('RSI Bounce', 'No pool yet · 2 players', 'Waits for the crowd to overdo it. One tap.', false)}
     <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 12px; border: 1px dashed ${LINE}; font-size: 14px; color: ${BODY};"><div>Build your own strategy</div><div style="font-size: 12px; color: ${MUTED};">coming soon →</div></div>
     <div style="margin-top: auto; display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: ${MUTED};"><div style="display: flex; gap: 14px;"><div>Leaderboard</div><div>Invite</div></div><div style="display: flex; gap: 14px;"><div>History</div><div>Risk</div><div>Account</div></div></div>
   </div>`,

  lesson: () => page(
    `<div style="display: flex; align-items: center; justify-content: space-between;"><div style="font-size: 13px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">DIRECTION · HOW IT WORKS</div><div style="font-size: 14px; color: ${MUTED};">Skip</div></div>
     <div style="height: 200px; border-radius: 16px; ${PH}"></div>
     <div style="display: flex; gap: 6px;"><div style="width: 24px; height: 4px; border-radius: 2px; background: ${INK};"></div><div style="width: 24px; height: 4px; border-radius: 2px; background: ${HAIR};"></div><div style="width: 24px; height: 4px; border-radius: 2px; background: ${HAIR};"></div><div style="width: 24px; height: 4px; border-radius: 2px; background: ${HAIR};"></div></div>
     <div style="font-size: 26px; line-height: 1.15; font-weight: 700;">You call it</div>
     <div style="font-size: 17px; line-height: 1.45; color: ${BODY};">Up if you think Bitcoin rises in the next 15 minutes. Down if it falls. That is the whole decision.</div>
     ${small('Then: We run it · It ends by itself · What you risk')}`,
    btn('Next'), '60px 24px 32px'),

  tap: (net) => `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 28px; box-sizing: border-box; gap: 18px;">
     <div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; color: ${MUTED};">‹ Lobby</div><div style="font-size: 15px; font-weight: 600;">Direction · BTC</div>${badge(net)}<div style="margin-left: auto; width: 28px; height: 28px; border-radius: 14px; border: 1px solid ${LINE}; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #52525B;">?</div></div>
     <div style="display: flex; flex-direction: column; gap: 4px;">${small('Bitcoin now')}<div style="font-size: 36px; font-weight: 700; letter-spacing: -0.01em;">61 250</div></div>
     <div style="height: 260px; border-radius: 14px; ${PH}"></div>
     <div style="font-size: 18px; line-height: 1.25; font-weight: 700;">Where does Bitcoin go in the next 15 minutes?</div>
     <div style="display: flex; gap: 12px;"><div style="flex: 1; height: 72px; border-radius: 14px; border: 2px solid ${INK}; display: flex; flex-direction: column; align-items: center; justify-content: center;"><div style="font-size: 20px; font-weight: 700;">Up</div>${small('it rises')}</div><div style="flex: 1; height: 72px; border-radius: 14px; border: 2px solid ${INK}; display: flex; flex-direction: column; align-items: center; justify-content: center;"><div style="font-size: 20px; font-weight: 700;">Down</div>${small('it falls')}</div></div>
     <div style="display: flex; flex-direction: column; gap: 6px;"><div style="display: flex; align-items: center; gap: 6px; padding: 12px 14px; border-radius: 12px; background: ${SOFT}; font-size: 14px; color: ${BODY};"><div>750 AUSD</div><div style="color: #A1A1AA;">·</div>${term('15x')}<div style="color: #A1A1AA;">·</div>${term('stop off')}<div style="color: #A1A1AA;">·</div>${term('TP off')}<div style="margin-left: auto; color: ${MUTED};">›</div></div>${small('This tap risks at most 50 AUSD, all you put in.')}</div>
   </div>`,

  position: (net, opts = {}) => `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 28px; box-sizing: border-box; gap: 18px;">
     ${header('Direction · BTC', net)}
     ${opts.banner ? `<div style="padding: 12px 14px; border-radius: 12px; background: ${SOFT}; font-size: 14px; font-weight: 600;">${opts.banner}</div>` : ''}
     <div style="display: flex; flex-direction: column; gap: 6px; padding: 20px 16px; border-radius: 16px; background: ${SOFT};">${small('Up · 50 AUSD × 15x · in at 61 250')}<div style="font-size: 15px; color: ${BODY};">${opts.words ?? 'You are up'}</div><div style="font-size: 48px; font-weight: 700; letter-spacing: -0.02em; line-height: 1;">${opts.pnl ?? '+1.86'}</div>${small('AUSD · Bitcoin up 0.28% since you tapped')}</div>
     <div style="display: flex; flex-direction: column; gap: 8px;"><div style="display: flex; justify-content: space-between; font-size: 14px;"><div style="color: ${BODY};">Closes in</div><div style="font-weight: 600;">${opts.left ?? '11:42'}</div></div><div style="height: 6px; border-radius: 3px; background: ${HAIR}; overflow: hidden;"><div style="height: 6px; width: ${opts.pct ?? '22%'}; background: ${INK};"></div></div></div>
     <div style="height: 140px; border-radius: 14px; ${PH}"></div>
     ${small('Stops by itself at −25 AUSD. Fees so far 0.26 AUSD.')}
     <div style="margin-top: auto;">${btn('Close now', 'outline')}</div>
   </div>`,

  result: (net, opts = {}) => page(
    `<div style="font-size: 13px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">${opts.kicker ?? 'TIME IS UP'}</div>
     <div style="display: flex; flex-direction: column; gap: 8px;"><div style="font-size: 32px; line-height: 1.1; font-weight: 700;">${opts.title ?? 'You made'}</div><div style="font-size: 56px; font-weight: 700; letter-spacing: -0.02em; line-height: 1;">${opts.pnl ?? '+1.04'}</div><div style="font-size: 15px; color: #52525B;">AUSD · Bitcoin ${opts.move ?? 'up 0.24%'} in ${opts.dur ?? '15 min'} · fees 0.26</div></div>
     ${card(row('Your week', `${opts.week ?? '1 trade · +1.04 AUSD'}`) + row('Leaderboard', '#7 of 12') + row('Prize pool closes', 'Sunday'))}
     <div style="font-size: 16px; line-height: 1.45; color: ${BODY};">${opts.tomorrow ?? 'One tap a day is the game. Come back tomorrow for the next one.'}</div>`,
    btn(opts.button ?? 'Back to lobby') + `<div style="display: flex; justify-content: center; gap: 24px;">${opts.share === false ? '' : `<div style="height: 44px; display: flex; align-items: center; gap: 6px; font-size: 15px; color: #52525B;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"></path><path d="M12 15V3"></path><path d="M8 7l4-4 4 4"></path></svg>Share</div>`}${opts.again === false ? '' : `<div style="height: 44px; display: flex; align-items: center; font-size: 15px; color: #52525B;">Tap again</div>`}</div>`),

  // ---- returning user ----
  unlock: (net) => `<div style="flex: 1; position: relative;">${page(`${header('TradeAgent', net)}<div style="height: 120px; border-radius: 16px; ${PH}"></div><div style="font-size: 22px; font-weight: 700;">Welcome back</div>${p('Unlocking with Face ID…')}`, '', '60px 24px 32px')}
     <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;"><div style="width: 120px; height: 120px; border-radius: 28px; background: rgba(24,24,27,0.85); display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-size: 14px; font-weight: 600;">Face ID</div></div></div>`,

  today: (net, opts = {}) => `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 24px; box-sizing: border-box; gap: 16px;">
     <div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 15px; font-weight: 600;">Today</div>${badge(net, true)}<div style="margin-left: auto; font-size: 14px; color: #52525B;">${opts.balance ?? (net === 'testnet' ? '10 001' : '101')} AUSD</div></div>
     ${opts.banner ? `<div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 12px; border: 2px solid ${INK}; font-size: 14px; font-weight: 600;"><div>${opts.banner}</div><div>${opts.bannerAction ?? 'Claim'}</div></div>` : ''}
     ${card(row("Today's risk budget", opts.budget ?? '25 of 25 AUSD') + row('Streak', opts.streak ?? '3 days') + `<div style="height: 6px; border-radius: 3px; background: ${HAIR}; overflow: hidden;"><div style="height: 6px; width: ${opts.budgetPct ?? '0%'}; background: ${INK};"></div></div>`)}
     <div style="font-size: 22px; font-weight: 700;">${opts.heading ?? 'Your tap for today'}</div>
     ${opts.body ?? `<div style="display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 14px; border: 2px solid ${INK}; background: #FAFAFA;"><div style="display: flex; align-items: center; gap: 10px;"><div style="width: 56px; height: 56px; border-radius: 12px; ${PH}"></div><div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 17px; font-weight: 700;">Direction · BTC</div>${small('Recommended today · 15 minutes')}</div></div><div style="font-size: 14px; color: ${BODY};">Bitcoin now <b>61 250</b>. Where does it go in the next 15 minutes?</div><div style="display: flex; gap: 12px;"><div style="flex: 1; height: 60px; border-radius: 14px; border: 2px solid ${INK}; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700;">Up</div><div style="flex: 1; height: 60px; border-radius: 14px; border: 2px solid ${INK}; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700;">Down</div></div><div style="font-size: 14px; font-weight: 600;">50 AUSD · 10x · stop −50% · risks at most 25 AUSD</div></div>`}
     <div style="margin-top: auto; display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: ${MUTED};"><div>Other strategies</div><div style="display: flex; gap: 14px;"><div>Risk</div><div>Account</div></div></div>
   </div>`,

  doneToday: (net) => S.today(net, {
    budget: '0 of 25 AUSD', budgetPct: '100%', heading: 'Done for today',
    body: `${card(`<div style="font-size: 16px; line-height: 1.45; color: ${BODY};">Your tap for today is in. The next one opens tomorrow at 00:00.</div>${row('Opens in', '9 h 12 min')}`)}`,
  }),

  noPasskey: (net) => page(
    `${header('TradeAgent', net)}${h1('Sign in with your passkey')}${p('This device has no key for your account yet. Your passkey is the same account: sign in with it and everything is here.')}`,
    btn('Sign in with passkey') + btn('New here? Create account', 'link'), '60px 24px 32px'),

  outOfFunds: (net) => S.today(net, {
    balance: '0', heading: 'Add funds to keep playing',
    body: `${card(`<div style="font-size: 16px; line-height: 1.45; color: ${BODY};">Your account is empty. Add at least 100 AUSD from any chain and today's tap is open again.</div>`)}${btn('Add funds')}`,
  }),

  offline: (net) => page(
    `${header('TradeAgent', net)}<div style="height: 120px; border-radius: 16px; ${PH}"></div>${h1('The exchange is not answering')}${p('Nothing is lost. Your open trades keep their stops at the exchange. Last data from 12:41.')}`,
    btn('Try again', 'outline'), '60px 24px 32px'),
};

// ---- flow assembly ----
const phone = (title, inner, note = '', h = 844) =>
  `<div style="display: flex; flex-direction: column; gap: 10px; width: 390px; flex-shrink: 0;">
     <div style="font-size: 14px; font-weight: 600; color: ${INK}; height: 20px;">${title}</div>
     <div style="width: 390px; height: ${h}px; border-radius: 28px; border: 1px solid ${LINE}; background: #FFFFFF; color: ${INK}; box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column; position: relative;">${inner}</div>
     <div style="font-size: 13px; line-height: 1.4; color: ${MUTED}; min-height: 36px;">${note}</div>
   </div>`;
const arrow = (label) =>
  `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 110px; flex-shrink: 0; gap: 6px; padding-top: 30px;">
     <div style="font-size: 12px; font-weight: 600; color: ${BODY}; text-align: center; line-height: 1.3;">${label}</div>
     <svg width="90" height="20" viewBox="0 0 90 20" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10h78"></path><path d="M72 4l8 6-8 6"></path></svg>
   </div>`;
const strip = (steps) => `<div style="display: flex; align-items: flex-start;">${steps.map((s, i) => (i ? arrow(s.via) : '') + phone(`${i + 1} · ${s.title}`, s.inner, s.note ?? '', s.h)).join('')}</div>`;
const branchStrip = (title, items) =>
  `<div style="display: flex; flex-direction: column; gap: 14px; padding-top: 40px; border-top: 1px dashed ${LINE};">
     <div style="font-size: 16px; font-weight: 700;">${title}</div>
     <div style="display: flex; gap: 40px; align-items: flex-start;">${items.map((b) => phone(b.title, b.inner, b.note, b.h)).join('')}</div>
   </div>`;

const doc = (title, subtitle, body) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
    a { color: #18181B; } a:hover { color: #52525B; }
    @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(24,24,27,0.35); } 50% { box-shadow: 0 0 0 8px rgba(24,24,27,0); } }
    @keyframes slide { from { background-position: 0 0; } to { background-position: 40px 0; } }
    .pulse { animation: pulse 1.2s ease-out infinite; }
    .busy { background-image: repeating-linear-gradient(90deg, #18181B 0 12px, #52525B 12px 20px); background-size: 40px 6px; animation: slide 0.8s linear infinite; }
  </style>
</helmet>
<div style="display: inline-flex; flex-direction: column; gap: 28px; padding: 32px 40px 40px; background: #FAFAFA; color: ${INK}; box-sizing: border-box;">
  <div style="display: flex; flex-direction: column; gap: 4px;"><div style="font-size: 24px; font-weight: 700;">${title}</div><div style="font-size: 14px; color: ${MUTED};">${subtitle}</div></div>
  ${body}
</div>
</x-dc>
</body>
</html>
`;


export { INK, MUTED, BODY, LINE, SOFT, HAIR, PH, btn, badge, h1, p, small, card, row, MONAD, term, page, header, strategyCard, S, phone, arrow, strip, branchStrip, doc };
