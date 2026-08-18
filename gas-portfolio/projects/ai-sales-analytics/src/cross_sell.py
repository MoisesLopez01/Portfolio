"""Cross-sell recommendation engine — cluster accounts, recommend next product.

Unsupervised approach distilled from a production CRM analytics pipeline:

  1. Build a binary **account x product** ownership matrix from closed-won deals.
  2. **KMeans**-cluster accounts by their product mix into cohorts.
  3. For each cohort, compute per-product **penetration** (share of accounts that
     own it).
  4. For each account, recommend the highest-penetration product its cohort buys
     that the account does **not** yet own. Confidence = cohort penetration.
  5. Optionally project the matrix to 2-D with **PCA** for a cluster scatter plot.

Pure, deterministic (fixed ``random_state``), and testable. All demo data is
synthetic — no real accounts, products, or revenue.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler


def build_matrix(deals: pd.DataFrame) -> pd.DataFrame:
    """Binary account x product matrix from won deals.

    Expects columns ``account``, ``product``, ``is_won``. A 1 means the account
    has at least one closed-won deal for that product.
    """
    won = deals[deals["is_won"] == True]  # noqa: E712 - explicit for clarity
    if won.empty:
        return pd.DataFrame()
    matrix = (
        won.assign(owned=1)
           .pivot_table(index="account", columns="product", values="owned",
                        aggfunc="max", fill_value=0)
    )
    return (matrix > 0).astype(int)


def _choose_k(n_accounts: int) -> int:
    """Adaptive cluster count: small cohorts, bounded to a sensible range."""
    return min(5, max(2, n_accounts // 3))


def recommend(
    deals: pd.DataFrame,
    n_clusters: Optional[int] = None,
    min_confidence: float = 0.10,
) -> pd.DataFrame:
    """Return a cross-sell recommendation per account (where one clears the bar).

    Columns: ``account``, ``cluster``, ``products_owned``, ``recommended``,
    ``confidence`` (0-1), ``n_alternatives``.
    """
    matrix = build_matrix(deals)
    products = list(matrix.columns)
    if len(matrix) < 4 or len(products) < 2:
        return pd.DataFrame(columns=[
            "account", "cluster", "products_owned", "recommended",
            "confidence", "n_alternatives"])

    k = n_clusters or _choose_k(len(matrix))
    scaled = StandardScaler().fit_transform(matrix.values)
    labels = KMeans(n_clusters=k, random_state=42, n_init=10).fit_predict(scaled)
    matrix = matrix.copy()
    matrix["cluster"] = labels

    # Per-cluster product penetration.
    penetration = {}
    for c in range(k):
        members = matrix[matrix["cluster"] == c]
        if len(members):
            penetration[c] = (members[products].sum() / len(members)).to_dict()

    recs = []
    for account, row in matrix.iterrows():
        cluster = int(row["cluster"])
        owned = [p for p in products if row[p] > 0]
        missing = [p for p in products if row[p] == 0]
        if cluster not in penetration or not missing:
            continue
        pen = penetration[cluster]
        missing.sort(key=lambda p: pen.get(p, 0.0), reverse=True)
        top = missing[0]
        conf = round(float(pen.get(top, 0.0)), 3)
        if conf < min_confidence:
            continue
        recs.append({
            "account": account,
            "cluster": cluster,
            "products_owned": ", ".join(owned) if owned else "-",
            "recommended": top,
            "confidence": conf,
            "n_alternatives": len(missing) - 1,
        })

    columns = ["account", "cluster", "products_owned", "recommended",
               "confidence", "n_alternatives"]
    if not recs:
        return pd.DataFrame(columns=columns)
    return (pd.DataFrame(recs)
            .sort_values("confidence", ascending=False)
            .reset_index(drop=True))


def pca_coords(deals: pd.DataFrame, n_clusters: Optional[int] = None
               ) -> Tuple[pd.DataFrame, List[float]]:
    """2-D PCA projection of accounts, coloured by cluster (for a scatter plot)."""
    matrix = build_matrix(deals)
    if len(matrix) < 4 or matrix.shape[1] < 2:
        return pd.DataFrame(columns=["account", "pc1", "pc2", "cluster"]), [0.0, 0.0]

    k = n_clusters or _choose_k(len(matrix))
    scaled = StandardScaler().fit_transform(matrix.values)
    labels = KMeans(n_clusters=k, random_state=42, n_init=10).fit_predict(scaled)
    coords = PCA(n_components=2, random_state=42).fit_transform(scaled)
    var = PCA(n_components=2, random_state=42).fit(scaled).explained_variance_ratio_
    out = pd.DataFrame({
        "account": matrix.index,
        "pc1": coords[:, 0], "pc2": coords[:, 1],
        "cluster": labels,
    })
    return out, [round(float(v), 3) for v in var]
