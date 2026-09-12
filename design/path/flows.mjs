// Builds the four onboarding schemes (new/returning × testnet/mainnet).
// Run: node flows.mjs
import { writeFileSync } from 'node:fs';
import { S, strip, branchStrip, doc } from './screens.mjs';

const newUser = (net) => {
  const steps = [
    { title: 'Splash', inner: S.splash(), note: 'Logo and a short animation while the app loads.' },
    { title: 'Practice or real', via: 'automatic', inner: S.network(), note: 'Asked once. Switch later in Account.' },
    { title: 'Intro 1 · Smartest', via: net === 'testnet' ? 'Practice' : 'Real money', inner: S.intro(net, 0), note: 'Duolingo-style: sell the result. Top 0.01% who trade with AI, not the casino.' },
    { title: 'Intro 2 · Copilot', via: 'Next', inner: S.intro(net, 1), note: 'A tool that makes a trader, not a wealth button.' },
    { title: 'Intro 3 · Get good', via: 'Next', inner: S.intro(net, 2), note: 'Discipline as the felt result. No promise of income.' },
    { title: 'Passkey', via: "Let's go", inner: S.passkey(), note: 'Why a passkey, before the dialog.' },
    { title: 'System dialog', via: 'Create account', inner: S.dialog(), note: 'The phone\'s own dialog: Face ID.' },
  ];
  if (net === 'mainnet') {
    steps.push(
      { title: 'Add funds', via: 'Continue', inner: S.moneyPick(), note: 'From Monad directly, or from another chain over Aurora Intents. The «Real money» card at the start already said what this is.' },
      { title: 'Waiting', via: 'Get address', inner: S.moneyWait(), note: 'Polls until the transfer lands.' },
      { title: 'Arrived', via: 'transfer lands', inner: S.moneyDone(), note: '' },
      { title: 'Open account', via: 'Continue', inner: S.enable(net), note: 'One button hides approve, createAccount, forwarding.' },
    );
  } else {
    steps.push({ title: 'Open account', via: 'Continue', inner: S.enable(net), note: 'One button hides sign-in, test funds, approve, createAccount, forwarding.' });
  }
  steps.push(
    { title: 'Working', via: 'Open account', inner: S.enableProgress(net), note: net === 'testnet' ? 'Sign-in brings 1 MON and 10 000 AUSD; then three transactions.' : 'Three transactions, about a minute.' },
    { title: 'Lobby', via: '~1 min, automatic', inner: S.lobby(net, false), note: 'Direction highlighted for the first visit.' },
    { title: 'Lesson', via: 'Direction', inner: S.lesson(), note: 'Four steps, shown once, then behind «?».' },
    { title: 'Tap', via: 'Next ×3 · Got it', inner: S.tap(net), note: 'Defaults preselected. Dashed terms open a one-line explanation.' },
    { title: 'Position', via: 'Up', inner: S.position(net), note: 'Strategy key enrolled silently on this tap if missing.' },
    { title: 'Result', via: '15 min, or Close now', inner: S.result(net), note: 'Words and number, a reason to come back.' },
  );
  return strip(steps);
};

const returningUser = (net) => {
  const main = strip([
    { title: 'Splash', inner: S.splash(), note: 'Same splash; the network is remembered.' },
    { title: 'Unlock', via: 'automatic', inner: S.unlock(net), note: 'Face ID, no text. Phone: keychain session, no prompt at all.' },
    { title: 'Today', via: 'automatic', inner: S.today(net), note: 'Risk budget, one recommended strategy, one tap.' },
    { title: 'Position', via: 'Up', inner: S.position(net), note: '' },
    { title: 'Result', via: '15 min, or Close now', inner: S.result(net, { week: '4 trades · +3.10 AUSD', tomorrow: 'That was today\'s tap. Streak: 4 days. See you tomorrow.', button: 'Done', again: false }), note: 'Streak and the way back tomorrow.' },
    { title: 'Done for today', via: 'Done', inner: S.doneToday(net), note: 'Daily budget spent: nothing to tap until midnight.' },
  ]);
  const branches = [
    { title: 'Open position from last time', inner: S.position(net, { banner: 'Still open from 12:10', left: '03:15', pct: '78%' }), note: 'Shown instead of Today: number, countdown, Close.' },
    { title: 'Stop fired while away', inner: S.result(net, { kicker: 'STOPPED', title: 'You lost', pnl: '−25.00', move: 'down 5.1%', dur: '9 min', week: '2 trades · −23.96 AUSD', tomorrow: 'The stop did its job: that was the most this tap could lose.', button: 'Continue to Today' }), note: 'Result first, with the reason. Then Today.' },
    { title: 'Prize to claim', inner: S.today(net, { banner: 'Prize of the week: 1.20 AUSD' }), note: 'Banner above Today. One tap claims it.' },
    { title: 'Daily limit spent', inner: S.doneToday(net), note: 'Says when it opens again.' },
    { title: 'New device', inner: S.noPasskey(net), note: 'Same account, sign in with the passkey.' },
  ];
  if (net === 'mainnet') branches.push({ title: 'Out of funds', inner: S.outOfFunds(net), note: 'Add funds is the only live button.' });
  branches.push({ title: 'Exchange offline', inner: S.offline(net), note: 'Honest stub with the time of the last data.' });
  return main + branchStrip('What shows first when the app opens, depending on the state', branches);
};

const files = {
  'NewTestnet.dc.html': doc('1 · New user · testnet', 'First visit: splash, practice-or-real, a three-slide intro, then 5 actions to the first tap (Create account, Open account, Direction, Up). Test money arrives by itself.', newUser('testnet')),
  'ReturningTestnet.dc.html': doc('2 · Returning user · testnet', 'Second day: unlock, one tap, result. Below: what the app shows first depending on the state at open.', returningUser('testnet')),
  'NewMainnet.dc.html': doc('3 · New user · mainnet', 'Same path; «Real money» chosen at the start adds the deposit step. No separate consent screen. No testnet badge anywhere.', newUser('mainnet')),
  'ReturningMainnet.dc.html': doc('4 · Returning user · mainnet', 'Same as testnet, plus the out-of-funds branch.', returningUser('mainnet')),
};
for (const [name, html] of Object.entries(files)) writeFileSync(name, html);
console.log('wrote', Object.keys(files).join(', '));
