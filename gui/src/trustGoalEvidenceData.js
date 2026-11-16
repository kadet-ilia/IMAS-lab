/**
 * Frozen research evidence from execution of the actual E1 JavaScript kernel
 * on 2026-11-16. This is NOT a live calculation using the sidebar settings.
 * Reproduce with: node gui/scripts/trustGoalExperiment.mjs
 * The scalar model is not the four-dimensional experiment from the article.
 */
export const TRUST_GOAL_EVIDENCE = Object.freeze({
 modelVersion: "trust-js-2.13.0-unified-four-aggregators",
 measuredOn: "2026-11-16", seed: 20260716,
 mainRuns:60,controlRuns:40,nAgents:21,nBad:4,nSteps:70,attackStart:11,
 delta:0.10,trim:4,noise:0.20,isolationThreshold:0.25,
 methods:[
  {id:"arithmetic_mean",short:"Арифметическое",color:"#2672ff"},
  {id:"trust_weighted_mean",short:"С учётом доверия",color:"#079b91"},
  {id:"trimmed_unweighted",short:"Усечённое",color:"#d18a31"},
  {id:"proposed_robust",short:"Комбинированное",color:"#123a63"}
 ],
 accuracy:[
  {id:"static_bias",scenario:"Постоянное",rmse:[0.426989,0.320297,0.065858,0.065869],probability:[0.647778,0.651667,0.869167,0.867222],detection:1,delay:17.892,falseIsolations:0},
  {id:"subtle_bias",scenario:"Малозаметное",rmse:[0.082353,0.068777,0.065769,0.065603],probability:[0.753611,0.843333,0.869167,0.868889],detection:1,delay:17.892,falseIsolations:0},
  {id:"on_off",scenario:"On–off",rmse:[0.484321,0.381577,0.068020,0.068033],probability:[0.586111,0.585833,0.851111,0.851389],detection:0,delay:null,falseIsolations:0},
  {id:"collusion",scenario:"Согласованное",rmse:[0.426896,0.320206,0.065858,0.065869],probability:[0.647778,0.651667,0.869167,0.867222],detection:1,delay:17.892,falseIsolations:0}
 ],
 robustness:[
  {method:"Арифметическое",baseline:0.043027,attacked:0.426161,degradation:9.904},
  {method:"С учётом доверия",baseline:0.043040,attacked:0.319982,degradation:7.434},
  {method:"Усечённое",baseline:0.045375,attacked:0.065810,degradation:1.450},
  {method:"Комбинированное",baseline:0.045382,attacked:0.065840,degradation:1.451}
 ],
 trimSensitivity:[
  {method:"Арифметическое",k2rmse:0.426161,k2p:0.645833,k4rmse:0.426161,k4p:0.645833},
  {method:"С учётом доверия",k2rmse:0.319982,k2p:0.650417,k4rmse:0.319982,k4p:0.650417},
  {method:"Усечённое",k2rmse:0.115722,k2p:0.675000,k4rmse:0.065810,k4p:0.869167},
  {method:"Комбинированное",k2rmse:0.096426,k2p:0.722917,k4rmse:0.065840,k4p:0.866250}
 ],
 sampledTrajectory:[
  {step:1,arithmetic_mean:.035348,trust_weighted_mean:.035348,trimmed_unweighted:.038504,proposed_robust:.038504},
  {step:5,arithmetic_mean:.031787,trust_weighted_mean:.031776,trimmed_unweighted:.030665,proposed_robust:.030771},
  {step:10,arithmetic_mean:.031049,trust_weighted_mean:.030974,trimmed_unweighted:.034224,proposed_robust:.034232},
  {step:11,arithmetic_mean:.765422,trust_weighted_mean:.765591,trimmed_unweighted:.082321,proposed_robust:.082331},
  {step:12,arithmetic_mean:.759287,trust_weighted_mean:.714200,trimmed_unweighted:.072704,proposed_robust:.072652},
  {step:15,arithmetic_mean:.776080,trust_weighted_mean:.592566,trimmed_unweighted:.096198,proposed_robust:.096405},
  {step:20,arithmetic_mean:.764947,trust_weighted_mean:.577799,trimmed_unweighted:.084537,proposed_robust:.084651},
  {step:25,arithmetic_mean:.762224,trust_weighted_mean:.474049,trimmed_unweighted:.073436,proposed_robust:.073339},
  {step:30,arithmetic_mean:.211833,trust_weighted_mean:.116071,trimmed_unweighted:.047986,proposed_robust:.048077},
  {step:40,arithmetic_mean:.038536,trust_weighted_mean:.038563,trimmed_unweighted:.039710,proposed_robust:.039758},
  {step:50,arithmetic_mean:.030513,trust_weighted_mean:.030605,trimmed_unweighted:.035722,proposed_robust:.035769},
  {step:60,arithmetic_mean:.033773,trust_weighted_mean:.033804,trimmed_unweighted:.033321,proposed_robust:.033296},
  {step:70,arithmetic_mean:.034875,trust_weighted_mean:.034911,trimmed_unweighted:.037502,proposed_robust:.037381}
 ]
});
