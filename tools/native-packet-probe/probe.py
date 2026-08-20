import argparse
import json
import pathlib
import time

import frida


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', required=True, type=int)
    parser.add_argument('--seconds', type=float, default=10)
    parser.add_argument('--script', default=str(pathlib.Path(__file__).with_name('socket-hook.js')))
    args = parser.parse_args()

    session = frida.attach(args.pid)
    source = pathlib.Path(args.script).read_text(encoding='utf-8')
    script = session.create_script(source)

    def on_message(message, data):
        record = {'timestamp': time.time(), 'message': message}
        if data is not None:
            record['dataHex'] = bytes(data).hex()
        print(json.dumps(record, separators=(',', ':')), flush=True)

    script.on('message', on_message)
    script.load()
    time.sleep(args.seconds)
    script.unload()
    session.detach()


if __name__ == '__main__':
    main()
