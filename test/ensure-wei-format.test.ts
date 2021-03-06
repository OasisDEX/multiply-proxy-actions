import { BigNumber } from 'bignumber.js'
import { expect } from 'chai'
import { ensureWeiFormat } from './common/utils/params-calculation.utils'

describe(`ensureWeiFormat`, () => {
  it("should return BigNumber 38921235140000000000000 when supplied with string '38921.23514'", () => {
    const actual = ensureWeiFormat('38921.23514')
    expect(actual).to.be.deep.equal('38921235140000000000000')
  })

  it('should return BigNumber 38921235140000000000000 when supplied with number 38921.23514', () => {
    const actual = ensureWeiFormat(38921.23514)
    expect(actual).to.be.deep.equal('38921235140000000000000')
  })

  it('should return BigNumber 38921235140000000000000 when supplied with BigNumber 38921.23514', () => {
    const actual = ensureWeiFormat(new BigNumber(38921.23514))
    expect(actual).to.be.deep.equal('38921235140000000000000')
  })

  it("should return BigNumber 1000000000000000000 when supplied with string '1000000000000000000'", () => {
    const actual = ensureWeiFormat('1000000000000000000')
    expect(actual).to.be.deep.equal('1000000000000000000')
  })

  it('should return BigNumber 1000000000000000000 when supplied with BigNumber 1000000000000000000', () => {
    const actual = ensureWeiFormat(new BigNumber('1000000000000000000'))
    expect(actual).to.be.deep.equal('1000000000000000000')
  })
})
