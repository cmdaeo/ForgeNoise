## Hypothesis (revised after first run)

Naive construction - sampling Euclidean noise at Poincaré-disk coordinates -
does NOT produce hyperbolic-stationary noise. Because the field is
Euclidean-isotropic and the metric factor `(1-r²)/2` decays exponentially
with hyperbolic radius, the *apparent* feature size grows exponentially as
you approach the disk boundary when measured in hyperbolic units.

This is confirmed empirically: measured `mean_hyp_grad` decays from 11.1
(at r=0.02) to 1.95 (at r=0.79), fitting an exponential decay consistent
with `(1-r²)/2`.

**To produce genuinely hyperbolic-stationary noise requires a different
construction** - sampling 4D noise on the hyperboloid surface
`w² − x² − y² − z² = R²`, which is the correct exponential embedding.
This is the deferred experiment for Paper B.