"""
Jurisdiction-Aware Caption Engine.
Generates court-compliant document captions/headers from structured data.
These are SYSTEM-GENERATED — Claude never touches captions.

Supports: US Federal, US State, Uganda, UK, Kenya, Nigeria, Ghana,
South Africa, India, Canada, Australia, Hong Kong, Ireland.
"""
import html
from typing import Optional


# ─── Caption style registry ───────────────────────────────────────────

CAPTION_STYLES = {
    # US Federal — parentheses alignment style
    "us_federal": {
        "court_format": "IN THE UNITED STATES DISTRICT COURT\nFOR THE {district}",
        "party_separator": "v.",
        "party_format": "parentheses",  # right-side parentheses with case number
        "case_number_format": "Case No. {case_number}",
        "divider": "─" * 50,
        "alignment": "mixed",  # court centered, parties left, case# right
    },
    # US State — varies but generally similar to federal
    "us_state": {
        "court_format": "IN THE {court_name}\n{division}",
        "party_separator": "v.",
        "party_format": "parentheses",
        "case_number_format": "Case No. {case_number}",
        "divider": "─" * 50,
        "alignment": "mixed",
    },
    # Uganda — BETWEEN/AND with dotted leaders
    "uganda": {
        "court_format": "IN THE {court_level} OF UGANDA AT {location}\n({division})",
        "party_separator": "AND",
        "party_format": "between_and_dotted",
        "case_number_format": "{case_type_prefix} NO. {case_number} OF {year}",
        "divider": "─" * 60,
        "alignment": "centered",
    },
    # UK — clean BETWEEN/-and- style
    "uk": {
        "court_format": "IN THE {court_name}\n{division}",
        "party_separator": "-and-",
        "party_format": "between_and_clean",
        "case_number_format": "Claim No: {case_number}",
        "divider": "─" * 40,
        "alignment": "centered",
    },
    # Kenya — similar to Uganda
    "kenya": {
        "court_format": "IN THE {court_level} OF KENYA AT {location}\n({division})",
        "party_separator": "AND",
        "party_format": "between_and_dotted",
        "case_number_format": "{case_type_prefix} NO. {case_number} OF {year}",
        "divider": "─" * 60,
        "alignment": "centered",
    },
    # Nigeria — BETWEEN/AND
    "nigeria": {
        "court_format": "IN THE {court_level} OF {state}\n({division})",
        "party_separator": "AND",
        "party_format": "between_and_dotted",
        "case_number_format": "SUIT NO. {case_number}",
        "divider": "─" * 60,
        "alignment": "centered",
    },
    # Ghana — similar to Uganda/Nigeria
    "ghana": {
        "court_format": "IN THE {court_level} OF JUSTICE\n{division}\n{location}",
        "party_separator": "AND",
        "party_format": "between_and_dotted",
        "case_number_format": "SUIT NO. {case_number}",
        "divider": "─" * 60,
        "alignment": "centered",
    },
    # South Africa — BETWEEN/AND
    "south_africa": {
        "court_format": "IN THE {court_level} OF SOUTH AFRICA\n{division}\n{location}",
        "party_separator": "AND",
        "party_format": "between_and_dotted",
        "case_number_format": "Case No: {case_number}",
        "divider": "─" * 60,
        "alignment": "centered",
    },
    # India — IN THE HIGH COURT OF [STATE]
    "india": {
        "court_format": "IN THE {court_level} OF {state}\n{division}",
        "party_separator": "VERSUS",
        "party_format": "between_and_clean",
        "case_number_format": "{case_type_prefix} No. {case_number} of {year}",
        "divider": "─" * 50,
        "alignment": "centered",
    },
    # Canada — Court file no style
    "canada": {
        "court_format": "{court_name}\n{division}",
        "party_separator": "AND",
        "party_format": "between_and_clean",
        "case_number_format": "Court File No. {case_number}",
        "divider": "─" * 50,
        "alignment": "centered",
    },
    # Australia — Federal/Supreme Court
    "australia": {
        "court_format": "IN THE {court_name} OF AUSTRALIA\n{division}",
        "party_separator": "AND",
        "party_format": "between_and_clean",
        "case_number_format": "File No. {case_number}",
        "divider": "─" * 50,
        "alignment": "centered",
    },
    # Hong Kong — HCAL/HCMP format
    "hong_kong": {
        "court_format": "IN THE {court_level} OF THE\nHONG KONG SPECIAL ADMINISTRATIVE REGION\n{division}",
        "party_separator": "AND",
        "party_format": "between_and_clean",
        "case_number_format": "{case_type_prefix} NO. {case_number} OF {year}",
        "divider": "─" * 50,
        "alignment": "centered",
    },
    # Ireland — similar to UK
    "ireland": {
        "court_format": "THE {court_name}\n{division}",
        "party_separator": "-and-",
        "party_format": "between_and_clean",
        "case_number_format": "Record No. {case_number}",
        "divider": "─" * 40,
        "alignment": "centered",
    },
}

# Map jurisdiction codes to caption styles
JURISDICTION_TO_STYLE = {
    "US": "us_federal",
    "UK": "uk",
    "UG": "uganda",
    "KE": "kenya",
    "NG": "nigeria",
    "GH": "ghana",
    "ZA": "south_africa",
    "IN": "india",
    "CA": "canada",
    "AU": "australia",
    "HK": "hong_kong",
    "IE": "ireland",
}

# Document type prefixes for case number formatting
DOC_TYPE_PREFIXES = {
    "motion": "MISCELLANEOUS APPLICATION",
    "petition": "PETITION",
    "complaint": "CIVIL SUIT",
    "brief": "CIVIL APPEAL",
    "affidavit": "MISCELLANEOUS APPLICATION",
    "response": "MISCELLANEOUS APPLICATION",
    "reply": "MISCELLANEOUS APPLICATION",
    "demand_letter": "",
    "discovery": "CIVIL SUIT",
    "order": "MISCELLANEOUS APPLICATION",
    "stipulation": "CIVIL SUIT",
}

# Party role labels per jurisdiction family
ROLE_LABELS = {
    "us": {
        "plaintiff": "Plaintiff",
        "defendant": "Defendant",
        "applicant": "Petitioner",
        "respondent": "Respondent",
        "appellant": "Appellant",
        "appellee": "Appellee",
        "claimant": "Claimant",
        "petitioner": "Petitioner",
    },
    "commonwealth": {
        "plaintiff": "Plaintiff",
        "defendant": "Defendant",
        "applicant": "Applicant",
        "respondent": "Respondent",
        "appellant": "Appellant",
        "claimant": "Claimant",
        "petitioner": "Petitioner",
    },
    "uk": {
        "plaintiff": "Claimant",
        "defendant": "Defendant",
        "applicant": "Applicant",
        "respondent": "Respondent",
        "claimant": "Claimant",
        "appellant": "Appellant",
    },
}


def _get_role_family(jurisdiction: str) -> str:
    j = (jurisdiction or "US").upper()
    if j == "US":
        return "us"
    if j == "UK" or j == "IE":
        return "uk"
    return "commonwealth"


def _get_role_label(role: str, jurisdiction: str) -> str:
    family = _get_role_family(jurisdiction)
    labels = ROLE_LABELS.get(family, ROLE_LABELS["commonwealth"])
    return labels.get(role.lower(), role.title())


def _esc(text: str) -> str:
    """Escape HTML entities."""
    return html.escape(text or "")


def generate_caption_html(
    jurisdiction: str,
    court_name: str = "",
    court_level: str = "",
    division: str = "",
    location: str = "",
    district: str = "",
    state: str = "",
    parties: list = None,
    case_number: str = "",
    document_type: str = "motion",
    document_title: str = "",
    year: str = "",
    in_the_matter_of: str = "",
) -> str:
    """
    Generate a court-compliant caption in HTML format.
    This is SYSTEM-GENERATED — AI never modifies this.

    Args:
        jurisdiction: Country code (US, UG, UK, etc.)
        court_name: Full court name
        court_level: Level (High Court, Supreme Court, etc.)
        division: Division (Civil, Commercial, etc.)
        location: Court location
        district: US district name
        state: State/province name
        parties: List of dicts with 'name', 'role', 'entity_type'
        case_number: Case/docket number
        document_type: Type of document
        document_title: Title of the document
        year: Filing year
        in_the_matter_of: For "In the Matter of" style cases

    Returns:
        HTML string for the caption block.
    """
    if not parties:
        parties = []
    if not year:
        from datetime import datetime
        year = str(datetime.now().year)

    j = (jurisdiction or "US").upper()
    style_key = JURISDICTION_TO_STYLE.get(j, "us_federal")

    # Determine if US state vs federal
    if j == "US" and court_name and "district" not in court_name.lower():
        style_key = "us_state"

    style = CAPTION_STYLES[style_key]

    # Build court heading
    court_heading = _build_court_heading(
        style, j, court_name, court_level, division, location, district, state
    )

    # Build case number line
    case_type_prefix = DOC_TYPE_PREFIXES.get(document_type.lower(), "CIVIL SUIT")
    case_num_line = ""
    if case_number:
        case_num_line = style["case_number_format"].format(
            case_number=_esc(case_number),
            case_type_prefix=case_type_prefix,
            year=year,
        )

    # Build party block
    party_block = _build_party_block(style, parties, j, case_num_line)

    # "In the Matter of" line
    matter_line = ""
    if in_the_matter_of:
        matter_line = f'<div class="caption-matter" style="text-align:center;font-weight:bold;font-size:13px;margin:8px 0;">IN THE MATTER OF {_esc(in_the_matter_of.upper())}</div>'

    # Document title
    doc_title_html = ""
    if document_title:
        doc_title_html = f'<div class="caption-doc-title" style="text-align:center;font-weight:bold;font-size:14px;text-transform:uppercase;margin-top:16px;text-decoration:underline;">{_esc(document_title)}</div>'

    # Assemble
    caption_html = f"""<div class="legal-caption" style="font-family:'Times New Roman',serif;margin-bottom:24px;" contenteditable="false" data-caption-locked="true">
  <div class="caption-court-heading" style="text-align:center;font-weight:bold;font-size:14px;text-transform:uppercase;line-height:1.6;margin-bottom:12px;">
    {court_heading}
  </div>
  {f'<div class="caption-case-number" style="text-align:center;font-size:13px;font-weight:bold;margin-bottom:12px;">{case_num_line}</div>' if case_num_line and style["party_format"] != "parentheses" else ""}
  {matter_line}
  <div class="caption-divider" style="text-align:center;color:#888;letter-spacing:2px;margin:8px 0;">{style["divider"]}</div>
  {party_block}
  <div class="caption-divider" style="text-align:center;color:#888;letter-spacing:2px;margin:8px 0;">{style["divider"]}</div>
  {doc_title_html}
</div>"""

    return caption_html


def _build_court_heading(
    style: dict, jurisdiction: str, court_name: str, court_level: str,
    division: str, location: str, district: str, state: str,
) -> str:
    """Build the court name heading."""
    fmt = style["court_format"]

    # Fill in template variables
    heading = fmt.format(
        court_name=_esc(court_name or court_level or "COURT"),
        court_level=_esc(court_level or "HIGH COURT"),
        division=_esc(division) if division else "",
        location=_esc(location) if location else "",
        district=_esc(district) if district else "",
        state=_esc(state) if state else "",
    )

    # Clean up empty lines
    lines = [ln for ln in heading.split("\n") if ln.strip()]
    return "<br>".join(lines)


def _build_party_block(
    style: dict, parties: list, jurisdiction: str, case_num_line: str
) -> str:
    """Build the parties section based on jurisdiction style."""
    if not parties:
        return '<div style="text-align:center;color:#999;font-style:italic;">[Parties not yet specified]</div>'

    fmt = style["party_format"]

    if fmt == "parentheses":
        return _build_us_parentheses_block(parties, jurisdiction, case_num_line)
    elif fmt == "between_and_dotted":
        return _build_between_and_block(parties, jurisdiction, dotted=True)
    else:  # between_and_clean
        return _build_between_and_block(parties, jurisdiction, dotted=False)


def _build_us_parentheses_block(parties: list, jurisdiction: str, case_num_line: str) -> str:
    """US-style caption with parentheses alignment and case number on the right."""
    # Split parties into two sides
    left_parties = []
    right_parties = []
    for p in parties:
        role = (p.get("role") or "plaintiff").lower()
        if role in ("plaintiff", "petitioner", "claimant", "applicant", "appellant"):
            left_parties.append(p)
        else:
            right_parties.append(p)

    if not left_parties and parties:
        left_parties = [parties[0]]
        right_parties = parties[1:]
    if not right_parties and len(parties) > 1:
        right_parties = parties[1:]

    lines = []

    # Build using a table for proper alignment
    lines.append('<table class="caption-parties" style="width:100%;border-collapse:collapse;font-size:13px;margin:8px 0;" cellpadding="0" cellspacing="0">')

    # Left parties
    for i, p in enumerate(left_parties):
        name = _esc(p.get("name", "").upper())
        role_label = _get_role_label(p.get("role", "plaintiff"), jurisdiction)
        paren = ")" if i == 0 else ")"

        if i == 0:
            lines.append(f'<tr><td style="width:55%;padding:2px 0;"><strong>{name}</strong>,</td><td style="width:5%;text-align:center;">{paren}</td><td style="width:40%;text-align:right;"></td></tr>')
            lines.append(f'<tr><td style="padding:2px 0 2px 40px;"><em>{role_label}</em>,</td><td style="text-align:center;">)</td><td></td></tr>')
        else:
            lines.append(f'<tr><td style="padding:2px 0;"><strong>{name}</strong>,</td><td style="text-align:center;">)</td><td></td></tr>')
            lines.append(f'<tr><td style="padding:2px 0 2px 40px;"><em>{role_label}</em>,</td><td style="text-align:center;">)</td><td></td></tr>')

    # v. line with case number
    lines.append(f'<tr><td style="padding:4px 0;"></td><td style="text-align:center;">)</td><td style="text-align:right;font-weight:bold;">{_esc(case_num_line)}</td></tr>')
    lines.append(f'<tr><td style="padding:4px 0;font-weight:bold;">v.</td><td style="text-align:center;">)</td><td></td></tr>')
    lines.append(f'<tr><td></td><td style="text-align:center;">)</td><td></td></tr>')

    # Right parties
    for i, p in enumerate(right_parties):
        name = _esc(p.get("name", "").upper())
        role_label = _get_role_label(p.get("role", "defendant"), jurisdiction)

        lines.append(f'<tr><td style="padding:2px 0;"><strong>{name}</strong>,</td><td style="text-align:center;">)</td><td></td></tr>')
        period = "." if i == len(right_parties) - 1 else ","
        lines.append(f'<tr><td style="padding:2px 0 2px 40px;"><em>{role_label}</em>{period}</td><td style="text-align:center;">)</td><td></td></tr>')

    lines.append('</table>')
    return "\n".join(lines)


def _build_between_and_block(parties: list, jurisdiction: str, dotted: bool = True) -> str:
    """Commonwealth-style BETWEEN/AND caption with optional dotted leaders."""
    left_parties = []
    right_parties = []
    for p in parties:
        role = (p.get("role") or "applicant").lower()
        if role in ("plaintiff", "petitioner", "claimant", "applicant", "appellant"):
            left_parties.append(p)
        else:
            right_parties.append(p)

    if not left_parties and parties:
        left_parties = [parties[0]]
        right_parties = parties[1:]
    if not right_parties and len(parties) > 1:
        right_parties = parties[1:]

    separator = "·" * 40 if dotted else ""
    lines = []
    lines.append('<div class="caption-parties" style="font-size:13px;margin:12px 0;">')

    # BETWEEN header
    lines.append('<div style="text-align:center;font-weight:bold;margin-bottom:12px;">BETWEEN</div>')

    # Left parties (applicants/plaintiffs)
    for i, p in enumerate(left_parties):
        name = _esc(p.get("name", "").upper())
        role_label = _get_role_label(p.get("role", "applicant"), jurisdiction).upper()
        if dotted:
            lines.append(f'<div style="display:flex;justify-content:space-between;align-items:baseline;margin:4px 0;"><span style="font-weight:bold;">{name}</span><span style="flex:1;border-bottom:2px dotted #666;margin:0 8px;"></span><span style="font-weight:bold;">{role_label}</span></div>')
        else:
            lines.append(f'<div style="text-align:center;margin:8px 0;"><div style="font-weight:bold;font-size:14px;">{name}</div><div style="font-style:italic;">{role_label}</div></div>')

    # AND separator
    sep_text = "AND" if dotted else "-and-"
    lines.append(f'<div style="text-align:center;font-weight:bold;margin:12px 0;">{sep_text}</div>')

    # Right parties (respondents/defendants)
    for i, p in enumerate(right_parties):
        name = _esc(p.get("name", "").upper())
        role_label = _get_role_label(p.get("role", "respondent"), jurisdiction).upper()
        if dotted:
            lines.append(f'<div style="display:flex;justify-content:space-between;align-items:baseline;margin:4px 0;"><span style="font-weight:bold;">{name}</span><span style="flex:1;border-bottom:2px dotted #666;margin:0 8px;"></span><span style="font-weight:bold;">{role_label}</span></div>')
        else:
            lines.append(f'<div style="text-align:center;margin:8px 0;"><div style="font-weight:bold;font-size:14px;">{name}</div><div style="font-style:italic;">{role_label}</div></div>')

    lines.append('</div>')
    return "\n".join(lines)


def generate_caption_for_docx(
    jurisdiction: str,
    court_name: str = "",
    court_level: str = "",
    division: str = "",
    location: str = "",
    district: str = "",
    state: str = "",
    parties: list = None,
    case_number: str = "",
    document_type: str = "motion",
    document_title: str = "",
    year: str = "",
    in_the_matter_of: str = "",
) -> dict:
    """
    Generate caption data structured for python-docx rendering.
    Returns a dict with all caption components for the DOCX builder.
    """
    if not parties:
        parties = []
    if not year:
        from datetime import datetime
        year = str(datetime.now().year)

    j = (jurisdiction or "US").upper()
    style_key = JURISDICTION_TO_STYLE.get(j, "us_federal")
    if j == "US" and court_name and "district" not in court_name.lower():
        style_key = "us_state"

    style = CAPTION_STYLES[style_key]
    case_type_prefix = DOC_TYPE_PREFIXES.get(document_type.lower(), "CIVIL SUIT")

    # Build court heading lines
    heading_raw = style["court_format"].format(
        court_name=court_name or court_level or "COURT",
        court_level=court_level or "HIGH COURT",
        division=division or "",
        location=location or "",
        district=district or "",
        state=state or "",
    )
    court_lines = [ln.strip() for ln in heading_raw.split("\n") if ln.strip()]

    # Build case number
    case_num_text = ""
    if case_number:
        case_num_text = style["case_number_format"].format(
            case_number=case_number,
            case_type_prefix=case_type_prefix,
            year=year,
        )

    # Split parties
    left_parties = []
    right_parties = []
    for p in parties:
        role = (p.get("role") or "plaintiff").lower()
        if role in ("plaintiff", "petitioner", "claimant", "applicant", "appellant"):
            left_parties.append(p)
        else:
            right_parties.append(p)
    if not left_parties and parties:
        left_parties = [parties[0]]
        right_parties = parties[1:]

    return {
        "style_key": style_key,
        "court_lines": court_lines,
        "case_number_text": case_num_text,
        "party_format": style["party_format"],
        "party_separator": style["party_separator"],
        "left_parties": [
            {"name": p.get("name", "").upper(), "role": _get_role_label(p.get("role", "plaintiff"), jurisdiction)}
            for p in left_parties
        ],
        "right_parties": [
            {"name": p.get("name", "").upper(), "role": _get_role_label(p.get("role", "defendant"), jurisdiction)}
            for p in right_parties
        ],
        "document_title": (document_title or document_type or "MOTION").upper(),
        "in_the_matter_of": in_the_matter_of,
        "divider_char": "─",
    }
