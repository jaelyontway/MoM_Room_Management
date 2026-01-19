"""Find which port the server is running on."""
import requests
import socket

print("=" * 60)
print("查找服务器端口")
print("=" * 60)

# Test common ports
ports_to_test = [8002, 8001, 8000]

for port in ports_to_test:
    try:
        # Check if port is listening
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        result = sock.connect_ex(('127.0.0.1', port))
        sock.close()
        
        if result == 0:
            # Port is open, test if it's our server
            try:
                r = requests.get(f'http://127.0.0.1:{port}/api/status', timeout=2)
                if r.status_code == 200:
                    data = r.json()
                    print(f"\n[找到] 服务器运行在端口 {port}!")
                    print(f"\n访问地址: http://127.0.0.1:{port}")
                    print(f"\n状态信息:")
                    print(f"  使用真实API: {data.get('using_real_api')}")
                    print(f"  环境: {data.get('environment')}")
                    if data.get('using_real_api'):
                        print(f"\n[成功] 已连接到真实的 Square API!")
                    break
            except:
                pass
    except:
        pass
else:
    print("\n[未找到] 服务器可能没有运行")
    print("请运行: python run_fresh.py")

print("=" * 60)

