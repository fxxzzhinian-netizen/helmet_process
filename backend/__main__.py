import argparse
import logging

from waitress import serve

from .app import MAX_REQUEST, create_app


def main():
    parser = argparse.ArgumentParser(description="园区头盔复核演示服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    app = create_app()
    try:
        serve(app, host=args.host, port=args.port, threads=6, max_request_body_size=MAX_REQUEST)
    finally:
        app.extensions["helmet_service"].close()


if __name__ == "__main__":
    main()
