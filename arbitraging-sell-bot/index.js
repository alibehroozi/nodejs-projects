const https = require('https');
const cookie = require('cookie');
const fs = require('fs');
const request = require('request');
const { config } = require('./config');

const getOptions = (path, method = 'GET', cookieFile = true) => {
    const options = {
        hostname: 'www.arbitraging.co',
        port: 443,
        path: path,
        method: method,
        headers: {
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36',
        }
    };
    if (cookieFile) {
        options.headers['cookie'] = cookie.serialize('ci_sessions', fs.readFileSync('ci_sessions.txt').toString())
    }
    return options;
}

const getBlocksData = () => {
    return new Promise((resolve) => {
        console.log('Getting blocks data...');
        const req = https.request(getOptions('/platform/get_blocks_data'), (res) => {
            res.on('data', (data) => {
                const blocks = JSON.parse(data.toString());
                resolve(blocks);
            });
        });
        req.on('error', (e) => {
            console.log('Error getting blocks data');
            process.exit();
        });
        req.end();
    });
}


const getBalanceData = () => {
    return new Promise((resolve) => {
        console.log('Getting Balance data...');
        const req = https.request(getOptions('/platform/exchange_wallet_balance_beta'), (res) => {
            res.on('data', (data) => {
                if (data.toString() === 'needlogin') {
                    console.log('Login token expired! Please run again to login.');
                    fs.unlinkSync('ci_sessions.txt');
                    process.exit();
                }
                const balance = JSON.parse(data.toString());
                resolve(balance);
            });
        });
        req.on('error', (e) => {
            console.log('Error getting balance data');
            process.exit();
        });
        req.end();
    });
}

const doLogin = (email, password) => {
    return new Promise((resolve) => {
        if (!fs.existsSync('ci_sessions.txt')) {
            console.log('Performing login request...');
            const url = 'https://www.arbitraging.co/platform/auth';
            const headers = {
                'content-type': 'application/x-www-form-urlencoded'
            };
            const form = { email: email, pwd: password };
            request.post({ headers: headers, url: url, form: form, method: 'POST' }, (e, r, body) => {
                let ci_sessions = '';
                r.headers['set-cookie'].map((cookieStr) => {
                    const theCookie = cookie.parse(cookieStr);
                    if ('ci_sessions' in theCookie) {
                        if (theCookie['ci_sessions'] !== 'deleted') {
                            ci_sessions = theCookie['ci_sessions'];
                        }
                    }
                });
                if (ci_sessions) {
                    if (r.headers.location === 'https://www.arbitraging.co/platform/admin') {
                        fs.writeFileSync('ci_sessions.txt', ci_sessions);
                        console.log('LOGGED IN');
                        resolve();
                    } else {
                        console.log('Wrong email or password');
                        process.exit();
                    }
                } else {
                    console.log("Couldn't get ci_sessions");
                    process.exit();
                }

            });
        } else {
            resolve();
        }
    });
}




const placeSellOrder = (price, toSell, wallet) => {
    return new Promise((resolve) => {
        console.log('Placing sell order...');
        const url = 'https://www.arbitraging.co/platform/saveOrder_beta';
        const headers = {
            'content-type': 'application/x-www-form-urlencoded'
        };
        const form = { 'order_type': 'Sell', 'amount': toSell, 'price': price, 'wallet': wallet };
        request.post({ headers: headers, url: url, form: form, method: 'POST' }, (e, r, body) => {
            if (body === '') {
                console.log('Could not SELL.');
                process.exit();
            }
            const data = JSON.parse(body);
            if (data['error'] === 1) {
                console.log('Could not SELL.');
                process.exit();
            } else {
                console.log('SELL sucess! Sell amount: ' + toSell);
                process.exit();
            }
        });
    });
}

const checkBlocks = (exlimit) => {
    getBlocksData().then((blocks) => {
        const block = blocks[blocks.length - 1];
        console.log(blocks);
        blocks.map((block) => {
            if (block['arb_size'] - block['current_arb_size'] > 1) {
                console.log('Sell block found!');
                console.log('arb_size', block['arb_size']);
                console.log('current_arb_size', block['current_arb_size']);
                let toSell = block['arb_size'] - block['current_arb_size'];
                if (toSell > exlimit) {
                    toSell = exlimit;
                }
                placeSellOrder(block['price'], toSell.toString(), config.wallet).then(() => {
                });
            } else {
                console.log('No sell block.');
                console.log('=======================');
                setTimeout(() => {
                    checkBlocks(exlimit);
                }, config.block_check_time);
            }
        });

    });
}


doLogin(config.email, config.password).then(() => {
    getBalanceData().then((balanceData) => {
        let exlimit = 0;
        if (config.wallet === 'exchangeEarnedWallet') {
            exlimit = balanceData['ex_er_limit'];
        } else {
            exlimit = balanceData['ex_limit'];
        }
        console.log('Your sell limit: ' + exlimit);
        console.log('Starting to found sell block...');
        checkBlocks(exlimit);
    });
});


