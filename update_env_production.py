"""Script to update .env file with production Square credentials."""
import os
import re

# Production credentials
PRODUCTION_CREDENTIALS = {
    'SQUARE_ACCESS_TOKEN': 'EAAAloJo5lQHMs52re0UCZAQm0RfAekBDprx9pBwFihiWRdK_dDa3s-y-NM4MY2G',
    'SQUARE_APPLICATION_ID': 'sq0idp-OkGYrKxpsxd_FD0hG_eslg',
    'SQUARE_LOCATION_ID': 'L72T81FV9YPDT',
    'SQUARE_ENVIRONMENT': 'production'
}

def update_env_file():
    """Update .env file with production credentials."""
    env_file = '.env'
    
    if not os.path.exists(env_file):
        print(f"[ERROR] {env_file} file not found!")
        return False
    
    # Read current .env file
    with open(env_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # Update lines
    updated_lines = []
    updated = {}
    
    for line in lines:
        original_line = line
        line_stripped = line.strip()
        
        # Skip empty lines and comments (but keep them)
        if not line_stripped or line_stripped.startswith('#'):
            updated_lines.append(line)
            continue
        
        # Check if this line contains any of our credentials
        for key, value in PRODUCTION_CREDENTIALS.items():
            # Match lines like: KEY=value or KEY = value
            pattern = rf'^{key}\s*=\s*.*$'
            if re.match(pattern, line_stripped, re.IGNORECASE):
                updated_lines.append(f'{key}={value}\n')
                updated[key] = True
                break
        else:
            # Line doesn't match any credential, keep it as is
            updated_lines.append(line)
    
    # Add any missing credentials at the end of Square API Configuration section
    square_section_found = False
    insert_index = None
    
    for i, line in enumerate(updated_lines):
        if 'Square API Configuration' in line or 'SQUARE_ACCESS_TOKEN' in line:
            square_section_found = True
        if square_section_found and line.strip().startswith('#') and 'Options:' in line:
            insert_index = i
            break
    
    # Add missing credentials
    for key, value in PRODUCTION_CREDENTIALS.items():
        if key not in updated:
            if insert_index:
                updated_lines.insert(insert_index, f'{key}={value}\n')
            else:
                # Add after first Square config line
                for i, line in enumerate(updated_lines):
                    if 'SQUARE_ACCESS_TOKEN' in line and not line.strip().startswith('#'):
                        updated_lines.insert(i + 1, f'{key}={value}\n')
                        break
    
    # Write updated .env file
    with open(env_file, 'w', encoding='utf-8') as f:
        f.writelines(updated_lines)
    
    print("[OK] Updated .env file with production credentials:")
    for key, value in PRODUCTION_CREDENTIALS.items():
        print(f"  - {key}={value[:20]}...")
    
    return True

if __name__ == '__main__':
    print("=" * 60)
    print("Updating .env file with Production Square Credentials")
    print("=" * 60)
    
    if update_env_file():
        print("\n[SUCCESS] .env file updated!")
        print("\nNext steps:")
        print("  1. Restart your application: python run.py")
        print("  2. Test connection: python test_square_connection.py")
    else:
        print("\n[ERROR] Failed to update .env file")

