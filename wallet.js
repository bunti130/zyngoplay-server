const wallets = {};

function createWallet(userId){
if(!wallets[userId]){
wallets[userId] = 100;
}
return wallets[userId];
}

function addCoins(userId, amount){
wallets[userId] += amount;
}

function deductCoins(userId, amount){
wallets[userId] -= amount;
}

function getBalance(userId){
return wallets[userId] || 0;
}

module.exports = {
createWallet,
addCoins,
deductCoins,
getBalance
};
