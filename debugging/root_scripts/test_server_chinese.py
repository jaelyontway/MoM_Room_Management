"""测试服务器状态"""
import time
import requests
import json

print("等待服务器启动...")
time.sleep(8)

print("=" * 60)
print("服务器状态测试")
print("=" * 60)

try:
    r = requests.get('http://127.0.0.1:8001/api/status', timeout=5)
    print(f'状态码: {r.status_code}')
    
    if r.status_code == 200:
        print('\n[成功] 服务器正在运行!')
        data = r.json()
        print('\n响应:')
        print(json.dumps(data, indent=2, ensure_ascii=False))
        print(f'\n使用真实API: {data.get("using_real_api")}')
        
        if data.get('using_real_api'):
            print('\n[OK] 已连接到真实的 Square API!')
            print('\n访问地址: http://127.0.0.1:8001')
        else:
            print('\n[警告] 正在使用模拟数据')
    else:
        print(f'\n[错误] 状态码 {r.status_code}')
        print(f'响应: {r.text}')
        
except requests.exceptions.ConnectionError:
    print('\n[错误] 无法连接到服务器')
    print('服务器可能还在启动中，请稍等几秒再试')
except Exception as e:
    print(f'\n[错误] {e}')

print("=" * 60)

