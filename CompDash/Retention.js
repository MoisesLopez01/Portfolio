// ============================================================
// SCRIPT NAME: Comp Health Report — Retention engine (P2)
// PURPOSE:     Cohort rolling-window attrition with the dual
//              false-alarm gate (market mark AND the cohort's
//              own FY25/FY26 history), plus evidence packs.
// PURE. Same contract as Position.js — Node-testable.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.retention = 48;
