#!/usr/bin/env python3
"""TCP 单端口转发：模拟器(远端 Mac) → 本机 twibot API 的连接链路用。

用法: python3 tcp-relay.py <listen_host> <listen_port> <target_host> <target_port>
- 容器侧:   python3 tcp-relay.py 172.16.74.11 12000 127.0.0.1 12000
- Mac 侧:   python3 tcp-relay.py 127.0.0.1 12000 172.16.74.11 12000
配合 Mac 上 `adb reverse tcp:12000 tcp:12000`，模拟器内 App 的
http://127.0.0.1:12000 即达本机 twibot API。
"""
import socket
import sys
import threading


def pipe(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except Exception:
            pass


def main() -> None:
    listen_host, listen_port, target_host, target_port = (
        sys.argv[1],
        int(sys.argv[2]),
        sys.argv[3],
        int(sys.argv[4]),
    )
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((listen_host, listen_port))
    srv.listen(16)
    print(f"[relay] {listen_host}:{listen_port} -> {target_host}:{target_port}", flush=True)
    while True:
        conn, _ = srv.accept()
        try:
            tgt = socket.create_connection((target_host, target_port), timeout=10)
        except Exception:
            conn.close()
            continue
        threading.Thread(target=pipe, args=(conn, tgt), daemon=True).start()
        threading.Thread(target=pipe, args=(tgt, conn), daemon=True).start()


if __name__ == "__main__":
    main()