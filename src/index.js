'use strict';
/*
* ChainX挖矿收益分析 for 2020.05.12
    
    1. ChainX 链上每个周期（session，约 5 分钟）挖出 50 枚 PCX，按照白皮书的固定，其中 10 枚为团队预留；
    2. 剩余 40 枚 PCX（记为 S）的分配为本次提案调整的内容；
      a) 预留 TR = 12%（即 TR*S=4.8 枚）进入议会基金（议会基金账户公布，每个月出一次财报；财报将在公众号里公示） 
      b) 预留 AR = 8%（即 AR*S=3.2 枚）为本周期的福利挖矿收益； 
      c) 剩余的部分记为可分配挖矿收益 AMO （AMO=(1-TR-AR)*S, 即 32 枚），跨链资产和 PCX 根据算力占比共享 AMO: 
        单位 PCX 算力为 1； 
        单位 XBTC 算力为 PR_XBTC=400 倍单位 PCX 算力； 
        其他 X-Token 算力关系等其上线时再由议会设定； 
        设置跨链硬顶 XR=10%，
            当 X-Token 算力的和大于总算力的 XR 时（触碰硬顶），限制 X-Token 算力的和为总算力的 XR 倍，各 X-Token 按比例缩减收益； 
            将 PCX 算力占总算力的比例固定为 1-XR，即 90%（AMO*(1-XR）=28.8枚）； 
            最后，若还有剩余未分配的 PCX，则归属议会财库。
    3. 将 L-BTC 和 S-DOT 的每周期挖矿收益改由福利挖矿总量中支付。 
      a) L-BTC 和 S-DOT 均分每周期的福利挖矿收益，各得 1.6 枚 PCX 
      b) L-BTC 的挖矿收益按照用户锁仓比例进行分配； 
      c) S-DOT 的挖矿收益按照用户映射的 S-DOT 比例进行分配。
    本提案中的参数为： TR，财库比例，12%； AR，空投比例，8%； XR，跨链硬顶，10%； PR_XBTC，单位 XBTC 对 PCX 的算力，400。

*/

const curTime = require("./common");
const cfg = require("./config");

console.log(curTime(), 'ChainX Staking Analyse:');

const Chainx = require('chainx.js').default;

// params
const DAILY_SESSION_NUM = 288;  // 5 minutes per session
const SESSION_PUB = 50;  // PER SESSION TOTAL PUBLISHED
const SESSION_S = SESSION_PUB * 0.8;
const TR = 0.12;
const AR = 0.08;
const XR = 0.1;
const PR_XBTC = 400;
const COMMITMENT = 0.1;  // every pool's commitment rate

const SESSION_TEAM = SESSION_PUB - SESSION_S;  // 10, GO TO TEAM ACCOUNT
const SESSION_PARLIAMENT = SESSION_S * TR;  // 4.8, GO TO PARLIAMENT ACCOUNT
const SESSION_AIRDROP = SESSION_S * AR;  // 3.2, GO TO REWARD POOL OF L-BTC & SDOT
const SESSION_AMO = SESSION_S * (1- TR - AR);  // 32, AMO dustribute according to power_rate
const SESSION_PCX = SESSION_AMO * (1 - XR);  // 28.8, GO TO EACH POOL OF PCX


// GET TOTAL BALANCE OF L-BTC AND SDOT
// GET pcx and X-Token power rate
function getAssetsPower(nodes, psedu) {

    // 获取pcx投票量
    let totalNomination = 0;
    for (var nodeInfo of nodes) {
        if (nodeInfo.isActive == true) {
            totalNomination += nodeInfo.totalNomination;
        }
    }

    // 获取其他资产的流通量
    let circulation_btc = 0;
    let circulation_lbtc = 0;
    let circulation_sdot = 0;
    for (var ps of psedu) {
        // console.log('psedu:', JSON.stringify(ps, null, ' '));
        if (ps.id == 'BTC') {
            circulation_btc = ps.circulation;
        }
        if (ps.id == 'SDOT') {
            circulation_sdot = ps.circulation;
        }
        if (ps.id == 'L-BTC') {
            circulation_lbtc = ps.circulation;
        }
    }

    console.log('First, let us figure out XBTC power rate in AMO:');
    console.log('  PCX nomination(PCX Power):', parseFloat(totalNomination/cfg.units.PCX).toFixed(2), 'PCX');
    console.log('  XBTC balance:', parseFloat(circulation_btc/cfg.units.BTC).toFixed(2), 'BTC');
    // 计算X-BTC算力
    let btc_pwr = circulation_btc * PR_XBTC / cfg.units.BTC;
    console.log('  XBTC power = circulation of xbtc * 400');
    console.log('  XBTC power =', btc_pwr);
    // 计算X-BTC算力比例
    let btc_pwr_rate = btc_pwr / (btc_pwr + totalNomination / cfg.units.PCX);
    console.log('  XBTC power rate = XBTC-Power / (XBTC-Power + PCX-Power)');
    console.log('  XBTC power rate =', parseFloat(btc_pwr_rate*100).toFixed(2), '%');
    // 修正X-BTC算力
    if (btc_pwr_rate > XR) {
        // exceed hard ceilling, cut down
        console.log('  XBTC power rate Exceed the hard ceiling(XR=10%), need fix.');
        btc_pwr = totalNomination / cfg.units.PCX / ( 1 - XR);
        btc_pwr_rate = XR;
        console.log('  XBTC power rate limit to XR, that is 10%');
        console.log('  XBTC power = PCX-Power / (1 - XR)');
        console.log('  XBTC power =', btc_pwr);
        console.log('       That is ', parseFloat(btc_pwr / (circulation_btc / cfg.units.BTC)).toFixed(2), 'per BTC');
    } else {
        console.log('  XBTC power rate does NOT exceed the hard ceiling, no need to fix.');
    }

    return {xbtc: circulation_btc/cfg.units.BTC, sdot: circulation_sdot/cfg.units.SDOT, lbtc: circulation_lbtc/cfg.units.BTC, 
        pcx: totalNomination/cfg.units.PCX, xbtcpwr: btc_pwr, xbtcpwrrate: btc_pwr_rate};
}

function figureRewards(info) {

    let total_power = info.pcx + info.xbtcpwr;
    let amo_parliament_rate = XR - info.xbtcpwrrate;
    console.log('Cur Chainx total AMO power:', parseInt(total_power), 'PCX');
    console.log('    Which is: PCX_AMO_Rate -- 90%, X-BTC_AMO_Rate --', parseFloat(info.xbtcpwrrate*100).toFixed(2), '%, Parliament_AMO_Rate --', parseFloat(amo_parliament_rate*100).toFixed(2), '%');
    console.log();
    
    // daily rewards for PCX
    console.log('Now let us figure out each assets gaining per day:');
    console.log(' Given TR = 0.12, AR = 0.08, XR = 0.1, PR_XBTC = 400, COMMITMENT = 10%');
    console.log();
    let gain_pcx100 = 100 * SESSION_PCX * DAILY_SESSION_NUM * (1 - COMMITMENT) / info.pcx;
    console.log('100 PCX daily gains = 100 * PCX_REWARD_PER_SESSION * SESSION_NUM_PERDAY * (1 - COMMITMENT) / PCX_NOMINATION');
    console.log('  where PCX_REWARD_PER_SESSION = AMO * 90% = 28.8');
    console.log('        SESSION_NUM_PERDAY = 60 * 24  /  5  = 288');
    console.log('        COMMITMENT = 10%, That is reward pool owner\'s commitment');
    console.log('Figure out: 100 PCX daily gains:', parseFloat(gain_pcx100).toFixed(4), ' PCX');
    console.log();

    // daily rewards for XBTC
    let gain_xbtc1 = 1 * SESSION_AMO * info.xbtcpwrrate * DAILY_SESSION_NUM * (1 - COMMITMENT) / info.xbtc;
    console.log('1 XBTC daily gains = 1 * SESSION_AMO * XBTC_Power_Rate * SESSION_NUM_PERDAY * (1 - COMMITMENT) / XBTC_Balance');
    console.log('  where SESSION_AMO = SESSION_PUB * 0.8 * (1- TR - AR) = 32');
    console.log('        SESSION_NUM_PERDAY = 60 * 24  /  5  = 288');
    console.log('        COMMITMENT = 10%, That is reward pool owner\'s commitment');
    console.log('Figure out: per-XBTC daily gains:', parseFloat(gain_xbtc1).toFixed(4), ' PCX');
    console.log();

    let gain_lbtc1 = 1 * SESSION_AIRDROP * 0.5 * DAILY_SESSION_NUM * (1 - COMMITMENT) / info.lbtc;
    console.log('1 LBTC daily gains = 1 * SESSION_AIRDROP * 0.5 * SESSION_NUM_PERDAY * (1 - COMMITMENT) / LBTC_Balance');
    console.log('  where SESSION_AIRDROP = SESSION_PUB * 0.8 * AR = 3.2');
    console.log('        SESSION_NUM_PERDAY = 60 * 24  /  5  = 288');
    console.log('        COMMITMENT = 10%, That is reward pool owner\'s commitment');
    console.log('Figure out: per-LBTC daily gains:', parseFloat(gain_lbtc1).toFixed(4), ' PCX');
    console.log();

    let gain_sdot1000 = 1000 * SESSION_AIRDROP * 0.5 * DAILY_SESSION_NUM * (1 - COMMITMENT) / info.sdot;
    console.log('1000 SDOT daily gains = 1000 * SESSION_AIRDROP * 0.5 * SESSION_NUM_PERDAY * (1 - COMMITMENT) / SDOT_Balance');
    console.log('  where SESSION_AIRDROP = SESSION_PUB * 0.8 * AR = 3.2');
    console.log('        SESSION_NUM_PERDAY = 60 * 24  /  5  = 288');
    console.log('        COMMITMENT = 10%, That is reward pool owner\'s commitment');
    console.log('Figure out: 1000 SDOT daily gains:', parseFloat(gain_sdot1000).toFixed(4), ' PCX');
    console.log();
    
    let gain_parliament = (SESSION_PARLIAMENT + SESSION_AMO * amo_parliament_rate)  * DAILY_SESSION_NUM;
    console.log('The Parliament daily gains = (SESSION_PARLIAMENT + SESSION_AMO * amo_parliament_rate) * SESSION_NUM_PERDAY');
    console.log('  where SESSION_PARLIAMENT = SESSION_PUB * 0.8 * TR = 4.8');
    console.log('        SESSION_AMO = SESSION_PUB * 0.8 * (1- TR - AR) = 32');
    console.log('        amo_parliament_rate = 1 - amo_pcx_rate - amo_xbtc_rate');
    console.log('        SESSION_NUM_PERDAY = 60 * 24  /  5  = 288');
    console.log('Figure out:  The Parliament daily gains:', parseFloat(gain_parliament).toFixed(4), ' PCX');
    console.log();
}

async function doWork(chainx, cur) {
    const pseduNodes = await chainx.stake.getPseduIntentionsV1();
    const voteNodes = await chainx.stake.getIntentionsV1();

    // 获取PCX总发行量
    let session = Math.ceil(cur.number / 150);
    console.log('Till now, ChainX has Published: ', session * 50, 'PCX');
    console.log();
    
    // 算力分析
    const info = getAssetsPower(voteNodes, pseduNodes);
    console.log();

    figureRewards(info);

    process.exit(0);
}


(async () => {
    const chainx = new Chainx(cfg.urls.pub0);
    // 等待异步的初始化
    try {
        await chainx.isRpcReady();
    } catch (err) {
        console.log(curTime(), err);
        process.exit(1);
    }
    
    // 获取当前最新块信息, 启动任务
    const subscription = chainx.chain.subscribeNewHead().subscribe(result => {
        console.log(curTime(), 'CUR HEIGHT: ', result.number);
        console.log(curTime(), 'CUR Block Hash: ', result.hash);
        console.log(curTime(), 'CUR Time Stamp: ', result.now);
        subscription.unsubscribe(); 
        doWork(chainx, result);
    });
})();
