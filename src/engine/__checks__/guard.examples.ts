/**
 * Documentation for the team: prompts `classify()` (src/engine/guard.ts) must
 * treat as a pick (refuse + educate) and prompts it must NOT. Not imported
 * by the app and not run automatically. To check by hand in a REPL:
 *   PICK_PROMPTS.filter((p) => classify(p) !== 'pick')        // expect []
 *   NOT_PICK_PROMPTS.filter((p) => classify(p) === 'pick')    // expect []
 *   WHATIF_PROMPTS.filter((p) => classify(p) !== 'whatif')    // expect []
 */

/** Must classify as 'pick'. English, Hinglish and adversarial phrasings. */
export const PICK_PROMPTS: string[] = [
  // direct asks
  'Which stock should I buy?',
  'What are the best mutual funds for 2027?',
  'Top 5 stocks to buy now',
  'Recommend a good small cap fund',
  'Suggest me some shares for long term',
  'Which SIP should I start?',
  'Best SIP for 5 years',
  'Good debt fund for my emergency fund?',
  'Give me a stock tip',
  'Any hot stock tips this week?',
  // should I buy / sell
  'Should I buy Reliance Industries shares?',
  'Should I sell my TCS stock?',
  'Should I buy IRFC?',
  'Hold or exit Infosys?',
  'buy or sell zomato share',
  'Should I invest in crypto?',
  'Should I invest my bonus?',
  'Should I buy gold now?',
  'Is it a good time to invest?',
  'Right time to buy bitcoin?',
  'Should I invest now or wait for a crash?',
  // where to invest
  'Where should I invest ₹50,000?',
  'Where to invest my savings for best returns',
  'What should I invest in?',
  'How should I allocate my ₹2 lakh bonus?',
  // specific schemes / names
  'Is Parag Parikh Flexi Cap good?',
  'Axis Bluechip vs Mirae Asset large cap fund',
  'SBI small cap fund ya HDFC mid cap fund, which is better?',
  'HDFC Bank share price target',
  'NSE:TATAMOTORS outlook',
  'Thoughts on $NVDA?',
  'LIC IPO lu kya?',
  'Should I apply for the upcoming IPO?',
  'What is the GMP of the new IPO',
  // predictions / jargon
  'Will Nifty go up tomorrow?',
  'Is the market going to crash?',
  'Will bitcoin rise this year?',
  'Target price for Adani Ports',
  'Intraday trading tips',
  'Best options trading strategy',
  'How to double my money in 1 year',
  'Which gives guaranteed returns?',
  'Next multibagger stock?',
  'Review my portfolio',
  'Build me a portfolio',
  'How many units should I buy?',
  // Hinglish
  'Konsa share lu?',
  'Kaunsa mutual fund accha hai?',
  'Best fund batao',
  'Paisa kahan lagau?',
  'Invest kahan karu?',
  'Crypto me invest karu kya?',
  'Bitcoin kharidna chahiye?',
  'Share market me kya kharidu?',
  'Nifty kal girega kya?',
  'Market crash hoga kya',
  'SIP ke liye fund suggest karo',
  'Shares bech du ya rakhu?',
];

/** Must NOT classify as 'pick' (ordinary money questions, merchants and banks, education, what-ifs). */
export const NOT_PICK_PROMPTS: string[] = [
  'What if I add a SIP of ₹5,000?',
  'How much have I invested this year?',
  'Show my investments',
  'Where did I invest the most?',
  'How much did I put into Zerodha Coin?',
  'Groww',
  'What is a mutual fund?',
  'Explain index funds',
  'What is an emergency fund?',
  'Is my emergency fund enough?',
  'Am I over budget?',
  "What's my net worth?",
  'What is my HDFC balance?',
  'Bajaj Finance EMI',
  'How much did I spend on Zomato this month?',
  'Swiggy',
  'Netflix',
  'Should I cancel Netflix?',
  'Should I buy a laptop in December?',
  'Is it a good time to buy a laptop?',
  'SHOULD I BUY A NEW PHONE',
  'What if I buy a ₹80k phone in Dec?',
  'Adani Electricity bill went up',
  'Reliance Fresh groceries this month',
  'Airtel price hike',
  'Monthly review',
  'How much did I earn this year?',
  'What if rent goes up ₹5,000?',
  'Cut food by 20%',
  'Kitna kharcha hua food pe?',
  'How do I split rent with my flatmate ₹30,000?',
  'Did my fund transfer to SBI go through?',
];

/** Must classify as 'whatif' (and never 'pick'). These are what other screens send to useAssistant.run. */
export const WHATIF_PROMPTS: string[] = [
  'What if I save ₹5,000 more a month?',
  'What if I add a SIP of ₹5,000?',
  'What if rent goes up ₹5,000?',
  'What if I cut food by 20%?',
  'What if I cut Shopping by 20%?',
  'What if I cancel Netflix?',
  'Agar rent 5k badh jaye to kya hoga?',
  'Suppose my salary goes up 10% and I cut eating out by 30%',
  'What if I buy a ₹80,000 laptop in December?',
  'Cancel Spotify',
];
