/**
 * Guardrails. Bachat educates and models scenarios; it never picks a stock,
 * fund, crypto coin, IPO or any other security, never predicts markets and
 * never quotes prices. `classify` runs before anything else on every request
 * (English + Hinglish), and `guardOutput` checks every sentence a model wrote
 * before it reaches the screen.
 *
 * Pure and deterministic. Avoids regex look-behind (Hermes compatibility).
 */

export type Intent = 'pick' | 'whatif' | 'question';

/** Shown under refusals and scenario answers. */
export const FOOTER = 'Educational information only, not financial advice.';

/** The educational refusal shown when someone asks Bachat to pick an investment. */
export const REFUSAL =
  "Bachat doesn't pick stocks, mutual funds, crypto, IPOs or any other investment, and it doesn't predict markets. " +
  'It tracks what you put in, at cost. Here is how people usually think it through instead:\n' +
  '• Emergency fund first: keep 3–6 months of essential expenses somewhere safe and easy to reach (a savings account or FD) before taking market risk.\n' +
  '• Clear expensive debt: credit-card dues and personal loans usually cost more than investments reliably earn.\n' +
  '• Match risk to time: money you need within about 3 years usually stays in low-risk options; equity suits goals 5+ years away because it can fall sharply in any single year.\n' +
  '• Diversify: spreading money across many companies and asset types (equity, debt, gold) means one bad bet cannot sink the plan.\n' +
  '• Asset allocation beats stock-picking: decide your mix of equity and debt from your goals and how much ups and downs you can live with, then rebalance about once a year.\n' +
  '• Costs compound too: low-cost index funds, as a category, simply hold every company in a market index instead of trying to beat it, so their expense ratios are low. Compare expense ratios and lock-ins (ELSS, PPF, NPS) before you commit.\n' +
  'For advice on your own situation, talk to a SEBI-registered investment adviser (you can check registration on the SEBI website), and ignore "tips" from social media or messaging groups.\n' +
  'Want to see what investing does to your plan? Try "What if I add a SIP of ₹5,000?"';

// ------------------------------------------------------------------ vocab

/** Security / product nouns. `fund` alone is safe because emergency/rainy-day funds are rewritten first. */
const SEC =
  '(?:stocks?|shares?|equit(?:y|ies)|scrips?|mutual ?funds?|mfs?|funds?|etfs?|ipos?|nfos?|crypto(?:currenc(?:y|ies)|s)?|' +
  'bitcoins?|btc|ethereum|eth|dogecoin|doge|solana|altcoins?|meme ?coins?|crypto ?coins?|nfts?|f&o|fno|' +
  'futures and options|options? trading|call options?|put options?|bonds?|debentures?|ncds?|reits?|invits?|smallcases?|' +
  'small ?caps?|mid ?caps?|large ?caps?|flexi ?caps?|multi ?caps?|blue ?chips?|penny stocks?|gold etfs?|sgbs?|' +
  'sovereign gold bonds?|index funds?|elss|nifty ?bees|gold ?bees|mf schemes?|fund schemes?|portfolio|securit(?:y|ies)|' +
  'share ?market|stock ?market|share ?bazaa?r)';

/** Asking-for-a-pick words (English + Hinglish). */
const ASK =
  '(?:which|kaun ?sa|kaun ?si|kaun ?se|kon ?sa|kon ?si|kon ?se|konsa|konsi|konse|kaunsa|kaunsi|kaunse|kis|best|top|good|great|' +
  'better|safest|safe|highest|strongest|accha|achha|acha|acche|achhe|badhiya|sahi|recommended|trending|hot)';

/** Recommendation requests. */
const RECO =
  '(?:recommend\\w*|suggest\\w*|tips?|picks?|advice|advise|batao|bata do|bataiye|bata dijiye|bolo|btao|suggestion|recommendation)';


/** Big listed names that are not everyday merchants in this app: any trading/price word nearby counts. */
const LISTED_STRONG = [
  'reliance industries', 'ril', 'tcs', 'infosys', 'infy', 'wipro', 'hcl tech', 'hcltech', 'tech mahindra',
  'tata steel', 'tata power', 'tata elxsi', 'tata technologies', 'hindustan unilever', 'larsen', 'l&t',
  'adani enterprises', 'adani ports', 'adani green', 'adani power', 'ongc', 'ntpc', 'power grid', 'coal india',
  'sun pharma', 'dr reddy\\w*', 'divis', 'jio financial', 'pb fintech', 'irfc', 'rvnl', 'bhel', 'avenue supermarts',
  'eicher', 'mahindra and mahindra', 'm&m', 'ultratech', 'grasim', 'jsw steel', 'hindalco', 'vedanta', 'suzlon',
  'nhpc', 'sjvn', 'mazagon dock', 'cochin shipyard', 'pidilite', 'nvidia', 'alphabet', 'meta platforms', 'berkshire',
  'bitcoin', 'ethereum', 'solana', 'dogecoin', 'shiba inu', 'xrp', 'ripple', 'cardano', 'polygon', 'bnb', 'tether', 'usdt',
];

/**
 * Listed names that also show up as merchants, banks, lenders, utilities or
 * brands in people's statements ("HDFC ••1123", "Bajaj Finance EMI", "Adani
 * Electricity", "buy a Maruti"): only flagged next to explicit stock words.
 */
const LISTED_WEAK = [
  'hdfc', 'hdfc bank', 'icici', 'icici bank', 'sbi', 'axis', 'axis bank', 'kotak', 'tata', 'tata motors', 'bajaj',
  'bajaj finance', 'bajaj finserv', 'reliance', 'adani', 'zomato', 'eternal', 'swiggy', 'paytm', 'nykaa', 'irctc', 'lic',
  'airtel', 'bharti airtel', 'jio', 'dmart', 'ola', 'ola electric', 'apple', 'google', 'amazon', 'microsoft', 'tesla',
  'mamaearth', 'vodafone idea', 'mahindra', 'maruti', 'hero motocorp', 'titan', 'trent', 'itc', 'hal', 'bel', 'mrf',
  'dixon', 'polycab', 'asian paints', 'britannia', 'nestle india', 'cipla', 'bpcl', 'hpcl', 'ioc', 'gail', 'delhivery',
  'policybazaar', 'ixigo', 'hyundai', 'yes bank', 'indusind', 'pnb', 'bank of baroda', 'canara bank', 'idfc first',
  'bandhan bank', 'au small finance', 'hdfc life', 'sbi life', 'lic housing',
];

/** Fund houses: "<house> … fund/flexi cap/small cap/index/ELSS…" names a specific scheme. */
const FUND_HOUSES =
  '(?:parag parikh|ppfas|mirae(?: asset)?|axis|nippon(?: india)?|quant|motilal(?: oswal)?|uti|hdfc|icici(?: prudential| pru)?|' +
  'sbi|kotak|aditya birla(?: sun life)?|absl|dsp|tata|edelweiss|navi|canara robeco|franklin(?: templeton)?|invesco|bandhan|' +
  'hsbc|sundaram|groww|pgim|whiteoak|baroda bnp|mahindra manulife|union|lic mf|jm financial|trust mf|360 one|helios|bajaj finserv)';
const FUND_WORDS =
  '(?:mutual fund|fund|funds|mf|etf|flexi ?cap|small ?cap|mid ?cap|large ?cap|large and mid ?cap|multi ?cap|blue ?chip|' +
  'index fund|nifty (?:50|next 50|bees|index)|elss|tax ?saver|contra|balanced advantage|hybrid fund|gilt|bees)';

const MARKET_ACTION =
  '(?:shares?|stocks?|scrip|share price|stock price|price target|target price|target|ipo|fpo|nse|bse|f&o|' +
  'buy|sell|hold|exit|accumulate|invest in|investing in|kharid\\w*|bech\\w*|go up|go down|crash|rally|multibagger|' +
  'dividend|bonus shares|stock split|valuation|undervalued|overvalued|52 week|technical|chart|breakout|lu kya|lena chahiye|le lu)';

const WEAK_ACTION =
  '(?:shares?|stocks?|scrip|share price|stock price|target price|ipo|fpo|nse|bse|f&o|stock split|bonus shares|dividend)';

const join = (list: string[]) => '(?:' + list.join('|') + ')';

// ------------------------------------------------------------------ normalise

/** Lowercase, strip punctuation, and rewrite phrases that would trip the security vocabulary. */
function normalise(text: string): string {
  let t = ' ' + text.toLowerCase().replace(/[’‘`]/g, "'").replace(/[?!,;()"“”[\]{}…]/g, ' ') + ' ';
  t = t
    .replace(/\bemergency ?funds?\b/g, ' safety-kitty ')
    .replace(/\brainy[- ]day ?funds?\b/g, ' safety-kitty ')
    .replace(/\bsinking ?funds?\b/g, ' safety-kitty ')
    .replace(/\b(?:employee'?s? )?provident ?funds?\b/g, ' epf ')
    .replace(/\bzerodha coin\b/g, ' zerodha ')
    .replace(/\bfunds? (?:transfer|transferred)\b/g, ' moneymove ')
    .replace(/\bshared?\b(?= (?:of|with|this|the bill|bill|expenses?|rent|flat|room|cab|ride|my screen|screen))/g, ' splitwith ')
    .replace(/\bstock ?(?:up|pile)\b/g, ' restock ')
    .replace(/\s+/g, ' ');
  return t;
}

// ------------------------------------------------------------------ pick patterns

/**
 * Each pattern on its own is enough to call the request a pick. Commented with
 * the kind of request it catches. 30+ patterns.
 */
const PICK_PATTERNS: RegExp[] = [
  // 1 "which stock should I buy", "kaunsa mutual fund", "top 5 stocks", "best small cap fund", "good debt fund"
  new RegExp(`\\b${ASK}\\s+(?:\\w+\\s+){0,3}?${SEC}\\b(?!\\s+(?:did|have|had|was|were|has|is my|are my|do i have|i (?:have|hold|own|bought|paid)))`),
  // 2 "stocks to buy", "funds to invest in", "shares worth buying"
  new RegExp(`\\b${SEC}\\s+(?:to|worth)\\s+(?:buy|invest|pick|hold|accumulate|buying|investing|start)\\b`),
  // 3 "recommend a fund", "suggest some stocks", "suggest me SIP fund"
  new RegExp(`\\b${RECO}\\s+(?:me\\s+)?(?:a|an|some|any|few|a few|good|the|best|2|3|5|10)?\\s*(?:\\w+\\s+){0,2}${SEC}\\b`),
  // 4 "stocks recommendation", "fund suggest karo", "share tips do"
  new RegExp(`\\b${SEC}\\s+(?:\\w+\\s+){0,2}${RECO}`),
  // 5 "should I buy shares of…", "should I sell my mutual funds", "can I invest in crypto"
  new RegExp(`\\b(?:should|shall|can|must|do)\\s+i\\s+(?:buy|sell|hold|exit|invest|put|park|average|accumulate|book|switch|redeem|start)\\b.{0,40}\\b${SEC}\\b`),
  // 6 "should I invest (now / my bonus / in…)", "should I start investing"
  /\b(?:should|shall)\s+i\s+(?:start\s+)?invest(?:ing)?\b/,
  // 7 "what should I invest in", "what can I invest in"
  /\bwhat\s+(?:should|can|shall|do you think)\s+i\s+invest\b/,
  // 8 "where should I invest", "where to invest ₹50,000", "paisa kahan lagau", "kidhar invest karu"
  /\b(?:where|kahan|kaha|kahaan|kidhar|kaha pe|kahan pe)\b(?!\s+(?:did|have|has|had|was|were|is my|are my|do i see|can i see|kiya|kiye))(?:\s+\S+){0,6}?\s+(?:invest\w*|lagau\w*|lagaun|lagaoon|lagana|daalu|dalu|daalun|put my money|park my money|park money)\b/,
  // 9 "invest kahan karu", "paisa lagau kahan"
  /\b(?:invest\w*|lagau\w*|lagaun|lagana|daalu|dalu)\s+(?:\w+\s+)?(?:kahan|kaha|kahaan|kidhar|where)\b/,
  // 10 trading jargon that is always about specific securities
  /\b(?:target price|price target|stop ?loss|multi ?baggers?|intraday|swing trad\w*|day trad\w*|scalping|breakout stocks?|option chain|open interest|gmp|grey market premium|listing gains?|short squeeze|pump and dump)\b/,
  // 11 "stock tips", "share market tips", "trading tips", "hot stock", "crypto tips"
  /\b(?:stock|share|trading|market|crypto|option|f&o|fno|ipo|investment|investing|sip|mf|fund)\s+(?:tips?|calls?|picks?|ideas?)\b/,
  // 12 market predictions: "will nifty go up", "is the market going to crash", "will bitcoin rise"
  /\b(?:will|would|is|are|kya)\b.{0,30}\b(?:nifty|sensex|bank ?nifty|market|markets|bitcoin|btc|crypto|stocks?|shares?|gold|silver|rupee|dollar|share bazaa?r)\b.{0,30}\b(?:go up|go down|going up|going down|rise|fall|crash|recover|correct|moon|pump|dump|upar|neeche|niche|gir\w*|badh\w*|chadh\w*|toot\w*|bullish|bearish|rally)\b/,
  // 13 Hinglish predictions with the noun first: "nifty kal girega?", "market crash hoga kya"
  /\b(?:nifty|sensex|bank ?nifty|market|share bazaa?r|bitcoin|crypto|gold)\b.{0,25}\b(?:girega|giregi|gir jayega|badhega|badhegi|chadhega|upar jayega|upar jaega|neeche jayega|crash hoga|tootega|prediction|forecast|outlook|levels?)\b/,
  // 14 market timing: "is it a good time to invest", "right time to buy gold", "invest now or wait"
  new RegExp(
    `\\b(?:good|right|best|sahi|accha|achha)\\s+(?:time|samay|waqt|moment)\\s+(?:to|for|me|mein)?\\s*` +
      `(?:invest\\w*|enter the market|exit the market|(?:buy|sell|kharid\\w*|bech\\w*)\\s+(?:\\w+\\s+){0,2}?(?:${SEC}|gold|silver|crypto|bitcoin))\\b`,
  ),
  /\b(?:invest|buy|kharid\w*)\w*\s+(?:now|abhi|today|aaj)\s+(?:or|ya)\s+(?:wait|ruk\w*|later|baad)\b/,
  // 15 crypto + investing verbs, either order
  /\b(?:crypto\w*|bitcoin|btc|ethereum|eth|dogecoin|doge|solana|altcoins?|meme ?coins?|nfts?|web3 tokens?)\b.{0,30}\b(?:invest\w*|buy|kharid\w*|lu|lena|le lu|should|worth|safe|returns?|accha|achha|lagau\w*|profit)\b/,
  /\b(?:invest\w*|buy|kharid\w*|lagau\w*|put money|daalu)\b.{0,25}\b(?:crypto\w*|bitcoin|btc|ethereum|eth|dogecoin|doge|solana|altcoins?|meme ?coins?|nfts?)\b/,
  // 16 IPOs: "should I apply for the X IPO", "IPO lu kya", "is this IPO good"
  /\b(?:ipos?|nfos?)\b.{0,40}\b(?:apply|subscribe|buy|invest\w*|lena|lu|le lu|worth|good|accha|achha|safe|allot\w*|gmp|listing)\b/,
  /\b(?:apply|subscribe|invest\w*)\b.{0,25}\b(?:ipos?|nfos?)\b/,
  // 17 "double my money", "highest returns", "guaranteed returns", "10x"
  /\b(?:double|triple|10x|5x|2x)\s+(?:my\s+)?(?:money|paisa|investment|savings)\b/,
  /\b(?:guaranteed|highest|maximum|max|best|fastest|high)\s+returns?\b/,
  // 18 "which SIP should I start", "best SIP", "SIP ke liye fund"
  /\b(?:which|kaun ?sa|konsa|kaunsa|best|top|good|accha|achha)\s+sips?\b/,
  /\bsips?\s+(?:ke liye|ke lie|for)\s+(?:\w+\s+){0,2}(?:fund|scheme|kaunsa|konsa|which)\b/,
  // 19 "buy or sell", "hold or exit", "bechu ya rakhu"
  /\b(?:buy|sell|hold|exit|book profit)\s+(?:or|ya)\s+(?:sell|hold|buy|exit|wait|average)\b/,
  /\b(?:bech\w*|kharid\w*)\s+(?:du|doon|dun|lu|loon)?\s*(?:ya|or)\s+(?:rakh\w*|hold|ruk\w*)\b/,
  // 20 derivatives / leverage strategies
  /\b(?:f&o|fno|futures and options|options? trading|call options?|put options?|derivatives?|forex|margin trading)\b.{0,40}\b(?:how|should|which|strategy|strategies|tips?|profit|earn|kamau|karu|start)\b/,
  /\b(?:how|should|kaise)\b.{0,30}\b(?:f&o|fno|futures and options|options? trading|intraday|forex|margin trading)\b/,
  // 21 Hinglish share-bazaar: "share market me kya kharidu", "share bazaar mein paisa lagau"
  /\b(?:share|stock)\s*(?:market|bazaa?r)\b.{0,30}\b(?:kya|kaunsa|konsa|kharid\w*|lu|invest\w*|paisa|lagau\w*|daalu|shuru)\b/,
  // 22 noun + Hinglish buy/sell: "konsa share lu", "shares bech du kya", "fund le lu"
  new RegExp(`\\b${SEC}\\s+(?:\\w+\\s+){0,2}?(?:kharid\\w*|bech\\w*|lu|lun|loon|le lu|le lun|le loon|lena chahiye|lagau\\w*|daalu)\\b`),
  // 23 portfolio advice: "review my portfolio", "rebalance", "build me a portfolio", "allocate my ₹1L"
  /\b(?:portfolio)\b.{0,30}\b(?:review|rebalance|suggest\w*|recommend\w*|build|create|banao|bana do|make|construct|allocate|optimi[sz]e|check|fix)\b/,
  /\b(?:review|rebalance|suggest\w*|recommend\w*|build|create|banao|make|construct|optimi[sz]e)\b.{0,20}\bportfolio\b/,
  /\bhow\s+(?:should|do|can)\s+i\s+(?:allocate|invest|deploy)\b.{0,30}(?:₹|\brs\b|\binr\b|\blakh|\blac\b|crore|\d|\bbonus\b|\bsavings\b|\bmoney\b|\bpaisa\b)/,
  // 24 how many units/shares to buy
  /\bhow\s+(?:much|many)\s+(?:units|shares|stocks|coins|lots)\b/,
  // 25 prices / NAV / returns of a thing: "nav of", "price of bitcoin", "returns of X fund"
  /\b(?:nav|share price|stock price|current price|live price|returns?|cagr|xirr)\s+(?:of|for|on)\s+(?:\w+\s+){0,3}(?:fund|stock|share|etf|bitcoin|crypto|coin|ipo|scheme|index)\b/,
  // 26 compare two products: "X vs Y fund", "which is better ELSS fund A or B"
  new RegExp(`\\b${FUND_HOUSES}\\b.{0,30}\\b(?:vs|versus|better than|compared to)\\b.{0,30}\\b${FUND_HOUSES}\\b.{0,30}${FUND_WORDS}`),
  new RegExp(`\\b${FUND_WORDS}\\b.{0,30}\\b(?:vs|versus|better than|compared to|or|ya)\\b.{0,30}\\b${FUND_WORDS}\\b.{0,20}\\b(?:which|better|best|accha|achha|choose|pick|kaunsa|konsa)\\b`),
  // 27 a specific scheme by fund house: "parag parikh flexi cap", "axis bluechip", "sbi small cap fund"
  new RegExp(`\\b${FUND_HOUSES}\\s+(?:\\w+\\s+){0,3}?${FUND_WORDS}\\b`),
  // 28 a strongly-listed name with any market word, either order
  new RegExp(`\\b${join(LISTED_STRONG)}\\b.{0,30}\\b${MARKET_ACTION}`),
  new RegExp(`\\b${MARKET_ACTION}\\b.{0,30}\\b${join(LISTED_STRONG)}\\b`),
  // 29 merchant-like listed names only with explicit stock words: "zomato share", "hdfc stock price", "lic ipo"
  new RegExp(`\\b${join(LISTED_WEAK)}\\b\\s+(?:\\w+\\s+){0,2}?${WEAK_ACTION}\\b`),
  new RegExp(`\\b(?:should|shall|can)\\s+i\\s+(?:buy|sell|hold|exit|accumulate)\\s+(?:some\\s+|more\\s+|my\\s+)?${join(LISTED_WEAK)}\\b`),
  new RegExp(`\\binvest(?:ing)?\\s+in\\s+${join(LISTED_WEAK)}\\b(?!\\s+(?:fd|fixed deposit|rd|savings|account))`),
  // 30 is X a good investment / is gold safe to invest
  /\b(?:is|are|kya)\b.{0,30}\b(?:good|safe|accha|achha|sahi|worth it|better)\b.{0,15}\b(?:investment|to invest|invest karna|for investing|for investment)\b/,
  // 31 gold / silver / real estate as investment decisions
  /\b(?:should|shall)\s+i\s+(?:buy|invest in|sell)\s+(?:some\s+|more\s+|physical\s+|digital\s+)?(?:gold|silver|sgbs?|land|plots?|real estate|reits?)\b/,
  // 32 "what's the next big stock", "which coin will pump", "next multibagger"
  /\bnext\s+(?:big|hot)?\s*(?:stock|share|coin|crypto|multibagger|ipo)\b/,
];

/** All-caps tickers in the original casing: "should I buy IRFC", "NSE:TATAMOTORS", "$TSLA". */
const SAFE_CAPS = new Set([
  'EMI', 'EMIS', 'SIP', 'SIPS', 'FD', 'FDS', 'RD', 'PPF', 'NPS', 'EPF', 'ELSS', 'UPI', 'HRA', 'GST', 'TDS', 'ITR', 'PAN',
  'ATM', 'OK', 'LPG', 'TV', 'AC', 'LED', 'OLED', 'SUV', 'EV', 'PC', 'SSD', 'RAM', 'GPU', 'CPU', 'PS5', 'IPL', 'OTT', 'USB',
  'MBA', 'CA', 'AI', 'ID', 'DSLR', 'NOW', 'ME', 'MY', 'IT', 'THE', 'A', 'AN', 'I', 'ON', 'IN', 'TO', 'UP', 'NO', 'OR',
  'IF', 'AT', 'OF', 'SO', 'IS', 'DO', 'GO', 'BY', 'ALL', 'AND', 'FOR', 'BIKE', 'CAR', 'GIFT', 'HOME', 'FLAT',
]);

function hasTicker(original: string): boolean {
  if (/\b(?:NSE|BSE)\s*[:-]\s*[A-Z][A-Z0-9&-]{1,15}\b/i.test(original)) return true;
  if (/(?:^|\s)\$[A-Z]{1,6}\b/.test(original)) return true;
  // Someone typing in ALL CAPS ("SHOULD I BUY LAPTOP") is not naming tickers.
  const letters = original.replace(/[^A-Za-z]/g, '');
  const upper = original.replace(/[^A-Z]/g, '');
  if (letters.length >= 8 && upper.length / letters.length > 0.6) return false;
  const re = /\b(?:[Bb]uy|BUY|[Ss]ell|SELL|[Hh]old|HOLD|[Ee]xit|[Aa]ccumulate|[Kk]harid\w*|[Bb]ech\w*)\s+(?:some\s+|more\s+|my\s+)?([A-Z][A-Z0-9&]{1,11})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(original))) {
    if (!SAFE_CAPS.has(m[1])) return true;
  }
  return false;
}

/** True when the request asks Bachat to pick, rate, time or price a specific investment. */
export function isPickRequest(text: string): boolean {
  if (!text.trim()) return false;
  if (hasTicker(text)) return true;
  const t = normalise(text);
  return PICK_PATTERNS.some((re) => re.test(t));
}

// ------------------------------------------------------------------ what-if

const WHATIF_PATTERNS: RegExp[] = [
  /\b(?:what if|what happens if|what would happen|what'll happen|what will happen if|how about if|suppose|supposing|imagine|let's say|lets say|say i|assume|assuming|hypothetically|scenario)\b/,
  /\b(?:if)\s+(?:i|my|we|our|rent|salary|income|the rent|emi|i'm|im|food)\b/,
  /\b(?:agar|agr|maan lo|man lo|maano|socho|kya hoga|to kya|toh kya)\b/,
  // imperative scenario commands: "cut food by 20%", "cancel netflix", "add a SIP of 5k"
  /^\s*(?:cut|reduce|lower|increase|raise|trim|slash|boost|halve|double)\b.*(?:\d|half|all)/,
  /^\s*cancel\b/,
  /^\s*(?:add|start)\s+(?:a\s+)?sip\b/,
];

/** True when the text describes a hypothetical change to model. */
export function isWhatIf(text: string): boolean {
  const t = normalise(text);
  return WHATIF_PATTERNS.some((re) => re.test(t));
}

/** pick (refuse + educate) → whatif (model it) → question (answer from the device's numbers). */
export function classify(text: string): Intent {
  if (isPickRequest(text)) return 'pick';
  if (isWhatIf(text)) return 'whatif';
  return 'question';
}

// ------------------------------------------------------------------ output guard

/** Recommendation / prediction language a model reply must never contain. */
const OUTPUT_BANNED: RegExp[] = [
  /\b(?:i|we)\s+(?:would\s+)?(?:recommend|suggest|advise)\b.{0,50}\b(?:stocks?|shares?|funds?|etfs?|crypto|ipos?|bonds?|scheme|gold|sips? in)\b/,
  /\b(?:you should|you could|you can|consider|go for|opt for|pick|choose|try|look at|look into|check out)\b.{0,40}\b(?:buying|investing in|stocks?|shares?|funds?|etfs?|crypto|ipos?|bonds?|scheme|gold|silver)\b/,
  /\b(?:buy|sell|hold|exit|accumulate)\s+(?:now|today|this|these|it|them|more)\b/,
  /\b(?:target price|price target|stop ?loss|multi ?bagger|top picks?|best (?:mutual )?funds?|best stocks?|will (?:go up|go down|rise|fall|crash|rally)|guaranteed returns?|expected returns?|returns? of \d|\d+(?:\.\d+)?\s*% (?:returns?|cagr|xirr|p\.?a\.?|a year|annual))\b/,
  new RegExp(`\\b${join(LISTED_STRONG)}\\b`),
  new RegExp(`\\b${join(LISTED_WEAK)}\\b\\s+(?:\\w+\\s+){0,2}?${WEAK_ACTION}\\b`),
  new RegExp(`\\b${FUND_HOUSES}\\s+(?:\\w+\\s+){0,3}?${FUND_WORDS}\\b`),
  /\b(?:nse|bse)\s*[:-]/,
  /\b(?:nifty|sensex)\s+(?:will|is going|target|level)/,
];

/**
 * Prompt-injection fallout a reply must never carry: links, or asks to share or
 * enter a secret (bank text the AI read could contain "send your OTP to …").
 */
const OUTPUT_UNSAFE: RegExp[] = [
  /\bhttps?:\/\/|\bwww\.|\bbit\.ly\b|\btinyurl\b|\bwa\.me\b/,
  /\b(?:otp|cvv|upi pin|atm pin|pin|password|passcode|card number|account number)\b.{0,40}\b(?:share|send|enter|tell|give|type|forward|batao|bhejo|bata do|daalo)\b/,
  /\b(?:share|send|enter|tell|give|type|forward|batao|bhejo|bata do|daalo)\b.{0,40}\b(?:otp|cvv|upi pin|atm pin|pin|password|passcode|card number|account number)\b/,
  /\b(?:ignore|disregard)\s+(?:all\s+|the\s+|previous\s+|prior\s+|above\s+)*(?:instructions?|rules?)\b/,
];

interface FoundNumber { value: number; tol: number; percent: boolean; money: boolean; plain: boolean }

const NUM_RE = /(₹|rs\.?\s*|inr\s*)?(\d+(?:,\d+)*(?:\.\d+)?)\s*(%|percent\b|per cent\b|k\b|thousand\b|lakhs?\b|lacs?\b|l\b|crores?\b|cr\b)?/gi;

function findNumbers(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  const lower = text.toLowerCase();
  NUM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUM_RE.exec(lower))) {
    const [, cur, digits, unitRaw] = m;
    const unit = (unitRaw ?? '').trim();
    const n = Number(digits.replace(/,/g, ''));
    if (!isFinite(n)) continue;
    const decimals = digits.includes('.') ? digits.split('.')[1].length : 0;
    let mult = 1;
    if (unit === 'k' || unit === 'thousand') mult = 1e3;
    else if (/^(?:lakhs?|lacs?|l)$/.test(unit)) mult = 1e5;
    else if (/^(?:crores?|cr)$/.test(unit)) mult = 1e7;
    const percent = unit === '%' || unit.startsWith('per');
    const tol = mult > 1 ? Math.max(1, mult * 0.5 * Math.pow(10, -decimals)) : 1;
    out.push({ value: n * mult, tol, percent, money: !!cur || mult > 1, plain: !cur && mult === 1 && !percent });
  }
  return out;
}

function numberAllowed(f: FoundNumber, allowed: number[], thisYear: number): boolean {
  const v = f.value;
  if (v === 0 || v === 100) return true;
  if (f.plain && Number.isInteger(v) && v >= 1 && v <= 31) return true;
  if (f.plain && Number.isInteger(v) && v >= thisYear - 10 && v <= thisYear + 10) return true; // years in dates
  for (const a of allowed) {
    if (!isFinite(a)) continue;
    if (Math.abs(Math.abs(v) - Math.abs(a)) <= f.tol) return true;
    if (f.percent) {
      if (Math.abs(v / 100 - a) <= 0.006) return true;
    }
  }
  return false;
}

/**
 * Checks a model-written reply. Returns the trimmed text when it is safe, or
 * null when it names a security/fund, recommends or predicts, carries a link or
 * asks for a secret (OTP, PIN, password), or contains a
 * number the device did not compute (±1 rounding; 1–31, 100 and nearby years allowed).
 */
export function guardOutput(text: string, allowedNumbers: number[]): string | null {
  const reply = (text ?? '').trim();
  if (!reply) return null;
  if (isPickRequest(reply)) return null;
  if (hasTicker(reply)) return null;
  const t = normalise(reply);
  if (OUTPUT_BANNED.some((re) => re.test(t))) return null;
  const lower = reply.toLowerCase();
  if (OUTPUT_UNSAFE.some((re) => re.test(lower))) return null;
  const thisYear = new Date().getFullYear();
  for (const f of findNumbers(reply)) {
    if (!numberAllowed(f, allowedNumbers, thisYear)) return null;
  }
  return reply;
}
