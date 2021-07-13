const {ensureWeiFormat, convertToBigNumber,add,sub,mul,div} = require('./common/params-calculation-utils');
const { expect } = require("chai");
const { default: BigNumber } = require('bignumber.js');


describe("add", async function(){
    it("should evaluate 2+3= new Bignumber(5)",async function(){
        var result = add(2,3)
        expect(BigNumber.isBigNumber(result)).to.be.equal(true);
        expect(result.toFixed(0)).to.be.equal("5");
    })
    it("should evaluate new Bignumber(2)+3= new Bignumber(5)",async function(){
        var result = add(new BigNumber(2),new BigNumber(3))
        expect(BigNumber.isBigNumber(result)).to.be.equal(true);
        expect(result.toFixed(0)).to.be.equal("5");
    })
    it("should evaluate '2'+3= new Bignumber(5)",async function(){
        var result = add('2',3)
        expect(BigNumber.isBigNumber(result)).to.be.equal(true);
        expect(result.toFixed(0)).to.be.equal("5");
    })
})

describe("sub", async function(){
    it("should evaluate 2-3= new Bignumber(-1)",async function(){
        var result = sub(2,3)
        expect(BigNumber.isBigNumber(result)).to.be.equal(true);
        expect(result.toFixed(0)).to.be.equal("-1");
    })
    it("should evaluate new Bignumber(2)-3= new Bignumber(-1)",async function(){
        var result = sub(new BigNumber(2),3)
        expect(BigNumber.isBigNumber(result)).to.be.equal(true);
        expect(result.toFixed(0)).to.be.equal("-1");
    })
    it("should evaluate '2'-3= new Bignumber(-1)",async function(){
        var result = sub('2',3)
        expect(BigNumber.isBigNumber(result)).to.be.equal(true);
        expect(result.toFixed(0)).to.be.equal("-1");
    })
    
    it("should evaluate new Bignumber(2)-new BigNumber(3)= new Bignumber(-1)",async function(){
        var result = sub(new BigNumber(2),new BigNumber(3))
        expect(BigNumber.isBigNumber(result)).to.be.equal(true);
        expect(result.toFixed(0)).to.be.equal("-1");
    })

    it("should evaluate new Bignumber(2)-new BigNumber(3)= new Bignumber(-1)",async function(){
        var result = sub('2','3');
        expect(BigNumber.isBigNumber(result)).to.be.equal(true);
        expect(result.toFixed(0)).to.be.equal("-1");
    })
})

describe(`ensureWeiFormat`, async function() {
    it("should return BigNumber 38921235140000000000000 when supplied with string '38921.23514'", async function(){
        var actual = ensureWeiFormat('38921.23514');
        expect(actual).to.be.deep.equal("38921235140000000000000");
    })
    it("should return BigNumber 38921235140000000000000 when supplied with number 38921.23514", async function(){
        var actual = ensureWeiFormat(38921.23514);
        expect(actual).to.be.deep.equal("38921235140000000000000");
    })
    it("should return BigNumber 38921235140000000000000 when supplied with BigNumber 38921.23514", async function(){
        var actual = ensureWeiFormat(new BigNumber(38921.23514));
        expect(actual).to.be.deep.equal("38921235140000000000000");
    })
    it("should return BigNumber 1000000000000000000 when supplied with string '1000000000000000000'", async function(){
        var actual = ensureWeiFormat('1000000000000000000');
        expect(actual).to.be.deep.equal("1000000000000000000");
    })
    it("should return BigNumber 1000000000000000000 when supplied with BigNumber 1000000000000000000", async function(){
        var actual = ensureWeiFormat(new BigNumber('1000000000000000000'));
        expect(actual).to.be.deep.equal("1000000000000000000");
    })
});
