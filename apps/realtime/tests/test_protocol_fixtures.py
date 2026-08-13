import json
import re
from pathlib import Path

FIXTURES_DIRECTORY = (
    Path(__file__).resolve().parents[3] / "packages" / "protocol-contracts" / "fixtures"
)


def load_fixture(name: str) -> object:
    return json.loads((FIXTURES_DIRECTORY / name).read_text(encoding="utf-8"))


def test_golden_protocol_fixtures_have_python_parity_invariants() -> None:
    bootstrap_request = load_fixture("bootstrap-request.json")
    pairing_response = load_fixture("bootstrap-pairing-response.json")
    activation_v1 = load_fixture("activation-v1-request.json")
    activation_v2 = load_fixture("activation-v2-request.json")
    activation_pending = load_fixture("activation-pending-response.json")
    activation_claimed = load_fixture("activation-claimed-response.json")
    websocket = load_fixture("bootstrap-websocket-response.json")
    client_hello = load_fixture("client-hello.json")
    server_hello = load_fixture("server-hello.json")
    initial_list_request = load_fixture("mcp-tools-list-initial-request.json")
    initial_list_result = load_fixture("mcp-tools-list-initial-result.json")
    page_list_request = load_fixture("mcp-tools-list-page-request.json")
    page_list_result = load_fixture("mcp-tools-list-page-result.json")
    call_request = load_fixture("mcp-tools-call-request.json")
    call_result = load_fixture("mcp-tools-call-result.json")
    user_list_request = load_fixture("mcp-tools-list-user-request.json")
    user_list_result = load_fixture("mcp-tools-list-user-result.json")
    user_call_request = load_fixture("mcp-tools-call-user-request.json")

    assert isinstance(bootstrap_request, dict)
    assert re.fullmatch(
        r"(?:[0-9a-f]{2}:){5}[0-9a-f]{2}",
        bootstrap_request["headers"]["Device-Id"],
    )
    assert "Serial-Number" not in bootstrap_request["headers"]
    assert bootstrap_request["body"]["application"]["version"]
    assert bootstrap_request["body"]["board"]["type"]

    assert isinstance(pairing_response, dict)
    assert pairing_response["activation"].get("timeout_ms", 30_000) == 30_000

    assert isinstance(activation_v1, dict)
    assert activation_v1["headers"]["Activation-Version"] == "1"
    assert "Serial-Number" not in activation_v1["headers"]
    assert activation_v1["body"] == {}

    assert isinstance(activation_v2, dict)
    assert activation_v2["headers"]["Activation-Version"] == "2"
    assert re.fullmatch(
        r"(?:[0-9a-f]{2}:){5}[0-9a-f]{2}",
        activation_v2["headers"]["Device-Id"],
    )
    assert activation_v2["body"]["algorithm"] == "hmac-sha256"
    assert activation_v2["body"]["serial_number"] == activation_v2["headers"]["Serial-Number"]
    assert re.fullmatch(r"[0-9a-f]{64}", activation_v2["body"]["hmac"])

    assert activation_pending == {"status": 202, "body": ""}
    assert activation_claimed == {"status": 200, "body": "success"}

    assert isinstance(websocket, dict)
    assert "mqtt" not in websocket
    assert websocket["server_time"] == {"timestamp": 1735689600000, "timezone_offset": 420}
    assert websocket["websocket"].get("version", 1) == 1

    assert isinstance(client_hello, dict)
    assert client_hello["transport"] == "websocket"
    assert client_hello["features"]["mcp"] is True
    assert client_hello["audio_params"] == {
        "format": "opus",
        "sample_rate": 16000,
        "channels": 1,
        "frame_duration": 60,
    }

    assert isinstance(server_hello, dict)
    assert server_hello["transport"] == "websocket"
    assert server_hello["audio_params"] == {
        "format": "opus",
        "sample_rate": 24000,
        "channels": 1,
        "frame_duration": 60,
    }

    assert isinstance(initial_list_request, dict)
    assert initial_list_request["payload"]["method"] == "tools/list"
    assert "session_id" not in initial_list_request
    assert "params" not in initial_list_request["payload"]
    assert isinstance(initial_list_result, dict)
    initial_tools = initial_list_result["payload"]["result"]["tools"]
    assert initial_list_result["payload"]["result"]["nextCursor"] == "self.audio_speaker.set_volume"
    assert initial_tools[0]["inputSchema"]["type"] == "object"

    assert isinstance(page_list_request, dict)
    assert "session_id" not in page_list_request
    assert page_list_request["payload"]["id"] == initial_list_request["payload"]["id"] == 2
    assert page_list_request["payload"]["params"] == {
        "cursor": "self.audio_speaker.set_volume"
    }
    assert isinstance(page_list_result, dict)
    assert "nextCursor" not in page_list_result["payload"]["result"]
    discovered_names = {
        tool["name"] for tool in initial_tools + page_list_result["payload"]["result"]["tools"]
    }
    assert isinstance(call_request, dict)
    assert "session_id" not in call_request
    assert call_request["payload"]["params"]["name"] in discovered_names
    assert isinstance(call_result, dict)
    assert call_result["payload"]["result"]["isError"] is False
    assert call_result["payload"]["result"]["content"][0]["type"] == "text"

    assert isinstance(user_list_request, dict)
    assert user_list_request["payload"]["params"] == {"withUserTools": True}
    assert isinstance(user_list_result, dict)
    user_tool = user_list_result["payload"]["result"]["tools"][0]
    assert user_tool["annotations"]["audience"] == ["user"]
    assert isinstance(user_call_request, dict)
    assert user_call_request["payload"]["params"]["name"] == user_tool["name"]

    packet = (FIXTURES_DIRECTORY / "v1-opus-packet.bin").read_bytes()
    assert len(packet) > 1
    assert not packet.startswith(b"OggS")
    assert not packet.startswith(b"OpusHead")
    # RFC 6716 TOC: configuration 11 encodes a 60ms SILK-only frame; bit 2 is mono.
    assert packet[0] >> 3 == 11
    assert packet[0] & 0b100 == 0
    assert packet[0] & 0b11 == 0
