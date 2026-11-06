import xml.etree.ElementTree as ET
from datetime import datetime, time
from email.utils import format_datetime

from fastapi import APIRouter
from fastapi.responses import Response

from cms.projects import load_all_projects

router = APIRouter()

SITE_TITLE = "Billy Bjork"
SITE_LINK = "https://billybjork.com"
SITE_DESCRIPTION = "Projects by Billy Bjork"


@router.get("/feed.xml", include_in_schema=False)
async def rss_feed():
    projects = load_all_projects()

    rss = ET.Element("rss", version="2.0")
    channel = ET.SubElement(rss, "channel")

    ET.SubElement(channel, "title").text = SITE_TITLE
    ET.SubElement(channel, "link").text = SITE_LINK
    ET.SubElement(channel, "description").text = SITE_DESCRIPTION

    for project in projects:
        item = ET.SubElement(channel, "item")
        slug = project.slug
        link = f"{SITE_LINK}/{slug}"

        ET.SubElement(item, "title").text = project.name
        ET.SubElement(item, "link").text = link
        ET.SubElement(item, "description").text = project.meta_description

        if project.created_on:
            ET.SubElement(item, "pubDate").text = format_datetime(
                datetime.combine(project.created_on, time.min)
            )

        guid = ET.SubElement(item, "guid", isPermaLink="true")
        guid.text = link

    xml_bytes = ET.tostring(rss, encoding="unicode", xml_declaration=False)
    xml_out = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml_bytes

    return Response(content=xml_out, media_type="application/rss+xml")
