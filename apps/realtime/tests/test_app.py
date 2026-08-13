import asyncio

from httpx import ASGITransport, AsyncClient, Response

from app.main import app


async def request_health() -> Response:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.get("/health")


def test_health_reports_realtime_service_ready() -> None:
    response = asyncio.run(request_health())

    assert response.status_code == 200
    assert response.json() == {"service": "realtime", "status": "ok"}
