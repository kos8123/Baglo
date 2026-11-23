#!/usr/bin/env python3
"""Generate AWS-style Baglo architecture diagrams with official AWS icons."""

from __future__ import annotations

import base64
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "architecture"
ICON_DIR = OUT / "aws-icons"

ICONS = {
    "cloud": "AWS-Cloud_32.svg", "region": "Region_32.svg", "users": "Res_Users_48_Dark.svg",
    "lambda": "Arch_AWS-Lambda_64.svg", "api": "Arch_Amazon-API-Gateway_64.svg",
    "cognito": "Arch_Amazon-Cognito_64.svg", "dynamodb": "Arch_Amazon-DynamoDB_64.svg",
    "s3": "Arch_Amazon-Simple-Storage-Service_64.svg", "eventbridge": "Arch_Amazon-EventBridge_64.svg",
    "secrets": "Arch_AWS-Secrets-Manager_64.svg", "cloudwatch": "Arch_Amazon-CloudWatch_64.svg",
    "cloudfront": "Arch_Amazon-CloudFront_64.svg", "codepipeline": "Arch_AWS-CodePipeline_64.svg",
    "codebuild": "Arch_AWS-CodeBuild_64.svg", "cloudformation": "Arch_AWS-CloudFormation_64.svg",
}


def uri(icon: str) -> str:
    data = base64.b64encode((ICON_DIR / ICONS[icon]).read_bytes()).decode()
    return f"data:image/svg+xml;base64,{data}"


def t(x: int, y: int, value: str, size: int = 16, weight: int = 500,
      anchor: str = "middle", color: str = "#16191f") -> str:
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="Arial,Helvetica,sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}">{escape(value)}</text>'


def service(x: int, y: int, icon: str, title: str, subtitle: str = "", size: int = 64) -> str:
    parts = [f'<image x="{x-size//2}" y="{y-size//2}" width="{size}" height="{size}" href="{uri(icon)}"/>',
             t(x, y + size//2 + 23, title, 14, 600)]
    if subtitle:
        parts.append(t(x, y + size//2 + 42, subtitle, 11, 400, color="#5f6b7a"))
    return "".join(parts)


def ext(x: int, y: int, w: int, h: int, title: str, subtitle: str = "", color: str = "#687078") -> str:
    parts = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="#fff" stroke="{color}" stroke-width="2"/>',
             t(x + w//2, y + 29, title, 14, 600)]
    if subtitle:
        parts.append(t(x + w//2, y + 49, subtitle, 11, 400, color="#5f6b7a"))
    return "".join(parts)


def boundary(x: int, y: int, w: int, h: int, title: str, color: str, icon: str | None = None,
             dashed: bool = False, fill: str = "#fff") -> str:
    dash = ' stroke-dasharray="7 5"' if dashed else ""
    parts = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="{color}" stroke-width="2.3"{dash}/>']
    tx = x + 18
    if icon:
        parts.append(f'<image x="{x+10}" y="{y+9}" width="30" height="30" href="{uri(icon)}"/>')
        tx = x + 50
    parts.append(t(tx, y + 31, title, 17, 700, "start"))
    return "".join(parts)


def line(points: list[tuple[int, int]], label: str = "", dashed: bool = False,
         color: str = "#232f3e", arrow: bool = True) -> str:
    path = " ".join(("M" if i == 0 else "L") + f"{x},{y}" for i, (x, y) in enumerate(points))
    dash = ' stroke-dasharray="7 5"' if dashed else ""
    marker = ' marker-end="url(#arrow)"' if arrow else ""
    parts = [f'<path d="{path}" fill="none" stroke="{color}" stroke-width="2"{dash}{marker}/>']
    if label:
        x, y = points[len(points)//2]
        width = max(70, len(label) * 7 + 14)
        parts += [f'<rect x="{x-width//2}" y="{y-17}" width="{width}" height="21" fill="#fff"/>',
                  t(x, y - 2, label, 11, 500, color="#3f4852")]
    return "".join(parts)


def start(w: int, h: int, title: str, subtitle: str) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img">
<title>{escape(title)}</title><desc>{escape(subtitle)}</desc>
<defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L0,8 L9,4 z" fill="#232f3e"/></marker></defs>
<rect width="100%" height="100%" fill="#fff"/>
<rect x="0" y="0" width="100%" height="14" fill="#232f3e"/>
{t(40, 55, title, 25, 700, "start")}{t(40, 82, subtitle, 13, 400, "start", "#5f6b7a")}
'''


def high_level() -> str:
    groups = [
        boundary(500, 110, 1010, 700, "AWS Cloud", "#232f3e", "cloud"),
        boundary(530, 165, 950, 610, "Region · us-east-1", "#00a4a6", "region", True, "#fbfdfe"),
        boundary(35, 145, 415, 630, "Cloudflare Edge", "#f38020", fill="#fffdf9"),
        boundary(1545, 145, 220, 630, "External services", "#687078", fill="#fafafa"),
        boundary(35, 845, 1730, 115, "Continuous delivery", "#879196", fill="#fafafa"),
    ]
    wires = [
        line([(105, 380), (140, 380), (140, 245), (180, 245)], "HTTPS"),
        line([(320, 285), (320, 330)], "K-lines"),
        line([(390, 235), (635, 235), (635, 253)], "sign in"),
        line([(390, 255), (520, 255), (520, 385), (775, 385), (775, 285), (805, 285)], "API"),
        line([(865, 285), (955, 285)], "invoke"),
        line([(1025, 285), (1215, 285)], "state"),
        line([(1025, 305), (1120, 305), (1120, 610), (1380, 610)], "objects"),
        line([(697, 485), (803, 485)], "trigger"),
        line([(867, 485), (953, 485)], "features"),
        line([(1017, 485), (1103, 485)], "selection"),
        line([(1165, 485), (1250, 485), (1250, 325)], "paper orders"),
        line([(1570, 270), (1520, 270), (1520, 215), (665, 215), (665, 253)], "OAuth", True),
        line([(1570, 420), (1480, 420), (1480, 400), (835, 400), (835, 453)], "market data"),
        line([(1570, 535), (1460, 535), (1460, 400), (1135, 400), (1135, 453)], "AI analysis"),
        line([(805, 680), (805, 545)], "secrets", True),
        line([(1025, 680), (1025, 545)], "logs", True),
        line([(260, 915), (513, 915)], "source"),
        line([(577, 915), (708, 915)], "test"),
        line([(772, 915), (908, 915)], "package"),
        line([(1000, 915), (1180, 915), (1180, 810)], "AWS deploy", True),
        line([(260, 920), (170, 920), (170, 775)], "frontend deploy", True),
    ]
    nodes = [
        f'<image x="55" y="335" width="58" height="58" href="{uri("users")}"/>', t(84, 420, "Users", 14, 600),
        ext(180, 215, 210, 60, "Cloudflare Pages", "React SPA + Pages Functions", "#f38020"),
        ext(180, 330, 210, 60, "R2 K-line cache", "daily · weekly · monthly", "#f38020"),
        ext(180, 445, 210, 60, "Market Sync Worker", "backfill + daily refresh", "#f38020"),
        service(665, 285, "cognito", "Amazon Cognito", "authentication"),
        service(835, 285, "api", "API Gateway", "HTTP API"),
        service(985, 285, "lambda", "API Lambda", "business logic"),
        service(1250, 285, "dynamodb", "DynamoDB", "trading ledger"),
        service(665, 485, "eventbridge", "EventBridge", "scheduler"),
        service(835, 485, "lambda", "Premarket", "feature analysis"),
        service(985, 485, "lambda", "Selection", "stock scoring"),
        service(1135, 485, "lambda", "AI Worker", "risk + orders"),
        service(1380, 610, "s3", "Amazon S3", "research + audit"),
        service(805, 680, "secrets", "Secrets Manager", "API keys"),
        service(1025, 680, "cloudwatch", "CloudWatch", "logs"),
        ext(1570, 235, 170, 60, "Google OAuth", "identity provider"),
        ext(1570, 390, 170, 60, "TWSE / TPEx", "official market data"),
        ext(1570, 505, 170, 60, "Gemini", "AI provider"),
        ext(1570, 620, 170, 60, "Fugle", "quotes"),
        ext(70, 887, 190, 55, "GitHub", "dev / main", "#24292f"),
        service(545, 915, "codepipeline", "CodePipeline"),
        service(740, 915, "codebuild", "CodeBuild"),
        service(940, 915, "cloudformation", "CloudFormation"),
    ]
    return start(1800, 990, "Baglo — High-Level AWS Architecture", "Serverless backend, edge delivery, market-data providers, and CI/CD") + "".join(groups + wires + nodes) + "</svg>"


def low_level() -> str:
    groups = [
        boundary(430, 110, 1100, 830, "AWS Cloud", "#232f3e", "cloud"),
        boundary(460, 165, 1040, 735, "Region · us-east-1", "#00a4a6", "region", True, "#fbfdfe"),
        boundary(500, 220, 220, 290, "Identity & API", "#8c4fff", fill="#fdfbff"),
        boundary(760, 220, 430, 540, "Compute", "#ed7100", fill="#fffaf5"),
        boundary(1230, 220, 230, 540, "Data", "#3f8624", fill="#fbfdf9"),
        boundary(500, 790, 960, 85, "Security & observability", "#dd344c", fill="#fffafa"),
        boundary(30, 145, 350, 650, "Cloudflare Edge", "#f38020", fill="#fffdf9"),
        boundary(1570, 145, 200, 650, "Providers", "#687078", fill="#fafafa"),
        boundary(30, 985, 1740, 160, "CI/CD", "#879196", fill="#fafafa"),
    ]
    wires = [
        line([(95, 330), (130, 330), (130, 255), (160, 255)], "HTTPS"),
        line([(330, 245), (400, 245), (400, 300), (575, 300)], "login"),
        line([(330, 265), (420, 265), (420, 430), (575, 430)], "API"),
        line([(635, 430), (820, 430)], "invoke"),
        line([(880, 430), (1285, 430)], "read/write"),
        line([(330, 390), (330, 455)], "read"),
        line([(260, 585), (260, 515)], "write"),
        line([(882, 610), (918, 610)], "trigger"),
        line([(982, 610), (1018, 610)], "features"),
        line([(1082, 610), (1118, 610)], "selection"),
        line([(1120, 640), (1120, 705), (1285, 705)], "orders"),
        line([(880, 400), (970, 400), (970, 300), (1285, 300)], "reports"),
        line([(1670, 270), (1535, 270), (1535, 300), (635, 300)], "OIDC", True),
        line([(1570, 420), (1515, 420), (1515, 540), (880, 540)], "market data"),
        line([(1570, 555), (1515, 555), (1515, 430), (880, 430)], "quotes"),
        line([(1570, 690), (1190, 690), (1190, 610), (1120, 610)], "AI"),
        line([(660, 830), (820, 830), (820, 670)], "secrets", True),
        line([(1030, 830), (970, 830), (970, 670)], "logs", True),
        line([(1315, 737), (1315, 798)], "origin"),
        line([(250, 1060), (468, 1060)], "source"),
        line([(532, 1060), (688, 1060)], "test"),
        line([(752, 1060), (908, 1060)], "package"),
        line([(1000, 1060), (1240, 1060), (1240, 940)], "AWS deploy", True),
        line([(250, 1090), (170, 1090), (170, 795)], "frontend deploy", True),
    ]
    nodes = [
        f'<image x="45" y="285" width="54" height="54" href="{uri("users")}"/>', t(72, 365, "Users", 14, 600),
        ext(160, 225, 170, 60, "Cloudflare Pages", "React SPA", "#f38020"),
        ext(160, 360, 170, 60, "Pages Function", "/market/history", "#f38020"),
        ext(160, 455, 170, 60, "R2 Bucket", "K-line cache", "#f38020"),
        ext(160, 585, 170, 60, "Market Worker", "backfill + refresh", "#f38020"),
        service(605, 300, "cognito", "Amazon Cognito", "email + Google OAuth"),
        service(605, 430, "api", "API Gateway", "public + JWT routes"),
        service(850, 430, "lambda", "API Lambda", "orders · portfolio · watchlist"),
        service(850, 610, "eventbridge", "EventBridge", "Taipei schedules"),
        service(950, 610, "lambda", "Premarket", "technical · fundamental · flow"),
        service(1050, 610, "lambda", "Selection", "universe + scoring"),
        service(1150, 610, "lambda", "AI Worker", "risk + paper orders"),
        service(1315, 300, "s3", "Research S3", "audit · reports · backtests"),
        service(1315, 430, "dynamodb", "DynamoDB", "cash · positions · orders"),
        service(1315, 705, "s3", "Website S3", "AWS-native option"),
        service(660, 830, "secrets", "Secrets Manager"),
        service(1030, 830, "cloudwatch", "CloudWatch"),
        service(1315, 830, "cloudfront", "CloudFront", "optional frontend"),
        ext(1590, 240, 160, 60, "Google OAuth", "identity"),
        ext(1590, 390, 160, 60, "TWSE / TPEx", "market data"),
        ext(1590, 525, 160, 60, "Fugle", "quotes"),
        ext(1590, 660, 160, 60, "Gemini", "AI analysis"),
        ext(65, 1030, 185, 55, "GitHub", "dev / main", "#24292f"),
        service(500, 1060, "codepipeline", "CodePipeline"),
        service(720, 1060, "codebuild", "CodeBuild"),
        service(940, 1060, "cloudformation", "CloudFormation"),
    ]
    return start(1800, 1175, "Baglo — Low-Level AWS Architecture", "Runtime components, trust boundaries, scheduled AI workflow, data stores, and deployment") + "".join(groups + wires + nodes) + "</svg>"


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "high-level.svg").write_text(high_level(), encoding="utf-8")
    (OUT / "low-level.svg").write_text(low_level(), encoding="utf-8")
