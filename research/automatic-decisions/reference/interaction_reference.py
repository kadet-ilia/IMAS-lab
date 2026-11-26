"""Independent exact rational calculation for E2.20 counterexample."""
from fractions import Fraction as F
from math import comb
import itertools

def bayes_risk(n, u0, u1, prior, b, f, d, c, rho, delta):
    risk = F(0)
    for m in range(n + 1):
        pm = comb(n, m) * (1 - delta)**m * delta**(n - m)
        for k in range(m + 1):
            def law(u):
                return (1-rho)*comb(m,k)*u**k*(1-u)**(m-k) + rho*((1-u)*(k==0)+u*(k==m))
            p0 = (1-prior) * law(u0)
            p1 = prior * law(u1)
            risk += pm * min(b*p1, f*p0+d*p1, c*(p0+p1))
    return risk

def main():
    c = [F(x) for x in ('0.18','0.50','0.60','2.3','6.9','1.83','1.01')]
    rhos, drops = map(lambda seq: tuple(map(F, seq)), [('0.56','0.67'),('0.25','0.39')])
    risks = [bayes_risk(9, *c, rho, delta) for rho,delta in itertools.product(rhos,drops)]
    contrast = risks[3]-risks[2]-risks[1]+risks[0]
    assert contrast == F(7831825181602737874368701426118297,48828125000000000000000000000000000000)
    assert contrast > 0
    print('Risks:', [float(v) for v in risks])
    print('Exact positive contrast:', contrast, '=', float(contrast))
    checks = 0
    for e,rho,delta in itertools.product(map(F,('.1','.2','.4')),map(F,('0','.3','1')),map(F,('0','.4','1'))):
        expected=e+(F(1,2)-e)*delta**3-(1-rho)*e*(1-e)*(1-2*e)*(1-delta)**3
        assert bayes_risk(3,e,1-e,F(1,2),F(1),F(1),F(0),F(1,2),rho,delta)==expected
        checks+=1
    print('Exact equality checks:',checks)

if __name__ == '__main__':
    main()
