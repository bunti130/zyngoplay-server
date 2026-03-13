function dealCards(players){

let deck = [];

const suits = ["H","D","C","S"];
const values = [2,3,4,5,6,7,8,9,10,"J","Q","K","A"];

for(let s of suits){
for(let v of values){
deck.push(v+s);
}
}

deck.sort(()=>Math.random()-0.5);

let hands = {};

players.forEach(p=>{
hands[p] = [deck.pop(), deck.pop()];
});

return hands;

}

module.exports = {
dealCards
};
