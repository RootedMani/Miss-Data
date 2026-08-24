# Simple CLI calculator

import sys

def print_help():
    print("Simple Calculator")
    print("Usage: python calculator.py <operator> <operand1> <operand2>")
    print("Operators: +  -  *  /")
    print("Example: python calculator.py + 3 5")

def main():
    if len(sys.argv) != 4:
        print_help()
        sys.exit(1)
    op, a_str, b_str = sys.argv[1], sys.argv[2], sys.argv[3]
    try:
        a = float(a_str)
        b = float(b_str)
    except ValueError:
        print("Operands must be numbers.")
        sys.exit(1)

    if op == '+':
        result = a + b
    elif op == '-':
        result = a - b
    elif op == '*':
        result = a * b
    elif op == '/':
        if b == 0:
            print("Error: Division by zero.")
            sys.exit(1)
        result = a / b
    else:
        print(f"Unsupported operator: {op}")
        print_help()
        sys.exit(1)

    print(f"Result: {result}")

if __name__ == "__main__":
    main()
