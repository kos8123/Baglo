#!/usr/bin/env python3
"""Render Baglo architecture SVGs with Graphviz and official AWS icons."""

from __future__ import annotations

import base64
import html
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCH = ROOT / "docs" / "architecture"
ICONS = ARCH / "aws-icons"
RENDER_ICONS = Path("/tmp/baglo-architecture-icons")
AWS_ICONS = {
    "lambda": "Arch_AWS-Lambda_64.svg", "api": "Arch_Amazon-API-Gateway_64.svg",
    "cognito": "Arch_Amazon-Cognito_64.svg", "dynamodb": "Arch_Amazon-DynamoDB_64.svg",
    "s3": "Arch_Amazon-Simple-Storage-Service_64.svg", "eventbridge": "Arch_Amazon-EventBridge_64.svg",
    "secrets": "Arch_AWS-Secrets-Manager_64.svg", "cloudwatch": "Arch_Amazon-CloudWatch_64.svg",
    "cloudfront": "Arch_Amazon-CloudFront_64.svg", "codepipeline": "Arch_AWS-CodePipeline_64.svg",
    "codebuild": "Arch_AWS-CodeBuild_64.svg", "cloudformation": "Arch_AWS-CloudFormation_64.svg",
}


def aws(node_id: str, icon: str, title: str, detail: str = "") -> str:
    path = html.escape(str((RENDER_ICONS / AWS_ICONS[icon]).with_suffix(".png")), quote=True)
    sub = f'<TR><TD COLSPAN="2"><FONT POINT-SIZE="10" COLOR="#5f6b7a">{html.escape(detail)}</FONT></TD></TR>' if detail else ""
    return f'''{node_id} [shape=plain label=<<TABLE BORDER="1" COLOR="#d5d9d9" CELLBORDER="0" CELLSPACING="0" CELLPADDING="8" BGCOLOR="white"><TR><TD FIXEDSIZE="TRUE" WIDTH="54" HEIGHT="54"><IMG SRC="{path}" SCALE="TRUE"/></TD><TD><B>{html.escape(title)}</B></TD></TR>{sub}</TABLE>>];'''


def ext(node_id: str, title: str, detail: str = "", color: str = "#f97316") -> str:
    return f'''{node_id} [shape=box style="rounded,filled" fillcolor="white" color="{color}" penwidth=2 label=<{html.escape(title)}<BR/><FONT POINT-SIZE="10" COLOR="#5f6b7a">{html.escape(detail)}</FONT>>];'''


def start(title: str) -> str:
    return f'''digraph G {{ graph [rankdir=LR bgcolor="#f8fafc" pad="0.35" nodesep="0.55" ranksep="0.85" splines=ortho compound=true newrank=true fontname="Arial" label=<{title}> labelloc=t labeljust=l fontsize=24]; node [fontname="Arial" fontsize=13 color="#d5d9d9" penwidth=1.3 margin="0.12,0.08"]; edge [fontname="Arial" fontsize=10 color="#52606d" fontcolor="#52606d" penwidth=1.8 arrowsize=0.75];'''


def high() -> str:
    return start("Baglo — High-Level Architecture") + f'''
    subgraph cluster_edge {{ label="Client & Cloudflare Edge"; color="#0891b2"; fontcolor="#03697e"; style="rounded"; penwidth=2;
      {ext("user", "Web User", "public view / signed-in trading", "#0f766e")}
      {ext("pages", "Cloudflare Pages", "React SPA + Pages Functions")}
      {ext("r2", "R2 + Market Worker", "prebuilt K-line cache")}
      user -> pages [xlabel="HTTPS"]; pages -> r2 [xlabel="K-lines"];
    }}
    subgraph cluster_aws {{ label="AWS Cloud · Serverless Backend"; color="#ff9900"; fontcolor="#b45309"; style="rounded"; penwidth=2;
      {aws("cognito", "cognito", "Amazon Cognito", "email + Google OAuth")}
      {aws("gateway", "api", "API Gateway", "HTTP API")}
      {aws("api", "lambda", "API Lambda", "Python business logic")}
      {aws("ledger", "dynamodb", "DynamoDB", "ledger + user state")}
      {aws("research", "s3", "Amazon S3", "research + audit")}
      {aws("schedule", "eventbridge", "EventBridge", "scheduled workflows")}
      {aws("workers", "lambda", "AI Lambdas", "analyze · select · execute")}
      {aws("secrets", "secrets", "Secrets Manager", "provider API keys")}
      {aws("logs", "cloudwatch", "CloudWatch", "logs + operations")}
      cognito -> gateway [xlabel="JWT"]; gateway -> api [xlabel="invoke"]; api -> ledger; api -> research;
      schedule -> workers [xlabel="trigger"]; workers -> ledger; workers -> research; secrets -> workers [dir=back];
      api -> logs [style=dashed]; workers -> logs [style=dashed];
    }}
    subgraph cluster_external {{ label="External Services"; color="#7c3aed"; fontcolor="#6d28d9"; style="rounded"; penwidth=2;
      {ext("market", "TWSE · TPEx · Fugle", "market data providers", "#7c3aed")}
      {ext("gemini", "Gemini", "structured AI analysis", "#7c3aed")}
      {ext("google", "Google OAuth", "identity provider", "#7c3aed")}
    }}
    pages -> gateway [xlabel="API calls"]; pages -> cognito [xlabel="sign in"];
    market -> api [dir=back xlabel="quotes"]; market -> workers [dir=back xlabel="features"];
    gemini -> workers [dir=back xlabel="AI"]; google -> cognito [dir=back style=dashed];
    subgraph cluster_cicd {{ label="Delivery Pipeline"; color="#475569"; fontcolor="#334155"; style="rounded"; penwidth=2;
      {ext("github", "GitHub", "dev / main branches", "#24292f")}
      {aws("pipeline", "codepipeline", "CodePipeline", "source orchestration")}
      {aws("build", "codebuild", "CodeBuild", "test + package")}
      {aws("iac", "cloudformation", "CloudFormation", "SAM / IaC deploy")}
      {ext("cfbuild", "Cloudflare Build", "Pages + Worker deploy")}
      github -> pipeline -> build -> iac; github -> cfbuild [style=dashed];
    }}
    iac -> gateway [style=dashed xlabel="deploy"]; cfbuild -> pages [style=dashed xlabel="deploy"];
    }}'''


def low() -> str:
    return start("Baglo — Low-Level Architecture") + f'''
    subgraph cluster_client {{ label="Browser & Cloudflare Edge"; color="#0891b2"; fontcolor="#03697e"; style="rounded"; penwidth=2;
      {ext("browser", "Browser", "React + TypeScript SPA", "#0f766e")}
      {ext("pages", "Cloudflare Pages", "static assets + SPA fallback")}
      {ext("edgefn", "Pages Function", "/market/history edge API")}
      {ext("r2", "R2 Bucket", "daily / weekly / monthly K-lines")}
      {ext("sync", "Market Sync Worker", "backfill + after-close refresh")}
      browser -> pages [xlabel="assets"]; browser -> edgefn [xlabel="history"]; edgefn -> r2 [xlabel="read"]; sync -> r2 [xlabel="write"];
    }}
    subgraph cluster_aws {{ label="AWS Cloud · Isolated dev / prod stack"; color="#ff9900"; fontcolor="#b45309"; style="rounded"; penwidth=2;
      {aws("cognito", "cognito", "Amazon Cognito", "hosted login + JWT")}
      {aws("gateway", "api", "API Gateway", "HTTP API + CORS")}
      {aws("api", "lambda", "API Lambda", "public + protected routes")}
      {aws("ledger", "dynamodb", "DynamoDB Ledger", "cash · positions · orders · watchlist")}
      {aws("research", "s3", "Research S3", "audit · reports · backtests")}
      {aws("schedule", "eventbridge", "EventBridge", "Taipei schedules")}
      {aws("premarket", "lambda", "Premarket Lambda", "features + analysis")}
      {aws("selection", "lambda", "Selection Lambda", "universe + scoring")}
      {aws("aiworker", "lambda", "AI Worker Lambda", "risk + paper orders")}
      {aws("secrets", "secrets", "Secrets Manager", "Gemini · Fugle · OAuth")}
      {aws("logs", "cloudwatch", "CloudWatch", "function logs")}
      {aws("webs3", "s3", "Website S3", "AWS-native static origin")}
      {aws("cdn", "cloudfront", "CloudFront", "optional distribution")}
      cognito -> gateway [xlabel="JWT"]; gateway -> api [xlabel="invoke"]; api -> ledger [xlabel="state"]; api -> research [xlabel="objects"];
      schedule -> premarket -> selection -> aiworker; premarket -> research; selection -> ledger; aiworker -> ledger [xlabel="paper orders"];
      secrets -> premarket [dir=back]; secrets -> selection [dir=back]; secrets -> aiworker [dir=back];
      api -> logs [style=dashed]; premarket -> logs [style=dashed]; selection -> logs [style=dashed]; aiworker -> logs [style=dashed]; webs3 -> cdn [xlabel="origin"];
    }}
    subgraph cluster_providers {{ label="External Providers"; color="#7c3aed"; fontcolor="#6d28d9"; style="rounded"; penwidth=2;
      {ext("google", "Google OAuth", "federated sign-in", "#7c3aed")}
      {ext("tw", "TWSE / TPEx", "official market data", "#7c3aed")}
      {ext("fugle", "Fugle", "quote / reference price", "#7c3aed")}
      {ext("gemini", "Gemini", "structured AI decision", "#7c3aed")}
    }}
    pages -> cognito [xlabel="login"]; pages -> gateway [xlabel="public / protected API"];
    google -> cognito [dir=back style=dashed]; tw -> sync [dir=back xlabel="daily data"]; tw -> premarket [dir=back];
    fugle -> api [dir=back xlabel="quotes"]; gemini -> selection [dir=back xlabel="analysis"];
    subgraph cluster_cicd {{ label="CI/CD"; color="#475569"; fontcolor="#334155"; style="rounded"; penwidth=2;
      {ext("github", "GitHub", "dev / main", "#24292f")}
      {aws("pipeline", "codepipeline", "CodePipeline", "branch pipeline")}
      {aws("build", "codebuild", "CodeBuild", "test + SAM package")}
      {aws("iac", "cloudformation", "CloudFormation", "backend + IaC")}
      {ext("cfbuild", "Cloudflare Build", "Pages + Worker")}
      github -> pipeline -> build -> iac; github -> cfbuild [style=dashed];
    }}
    iac -> gateway [style=dashed xlabel="AWS deploy"]; cfbuild -> pages [style=dashed xlabel="frontend deploy"];
    }}'''


def embed(svg: str) -> str:
    def replace(match: re.Match[str]) -> str:
        data = base64.b64encode(Path(html.unescape(match.group(1))).read_bytes()).decode("ascii")
        return f'href="data:image/png;base64,{data}"'
    return re.sub(r'(?:xlink:)?href="([^"]+\.png)"', replace, svg)


def render(name: str, source: str) -> None:
    dot_path, svg_path = ARCH / f"{name}.dot", ARCH / f"{name}.svg"
    dot_path.write_text(source, encoding="utf-8")
    subprocess.run(["dot", "-Tsvg", str(dot_path), "-o", str(svg_path)], check=True)
    svg_path.write_text(embed(svg_path.read_text(encoding="utf-8")), encoding="utf-8")


if __name__ == "__main__":
    ARCH.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(RENDER_ICONS, ignore_errors=True)
    shutil.copytree(ICONS, RENDER_ICONS)
    for source in RENDER_ICONS.glob("*.svg"):
        subprocess.run(["rsvg-convert", "-w", "128", "-h", "128", str(source), "-o", str(source.with_suffix(".png"))], check=True)
    render("high-level", high())
    render("low-level", low())
