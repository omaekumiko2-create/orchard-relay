"""Run on macOS/Linux: python3 -m unittest discover -s tests -p '*_test.py'."""
import importlib.util
import pathlib
import subprocess
import tempfile
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location('runner', pathlib.Path(__file__).resolve().parent.parent / 'mac/runner.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTest(unittest.TestCase):
    def test_archive_paths_stay_inside_build_copy(self):
        for value in ['../../file', '/tmp/file', 'ios/../file', 'ios\\file']:
            with self.assertRaises(ValueError):
                runner.safe_relative(value)
        self.assertEqual(str(runner.safe_relative('./ios/Project.xcodeproj')), 'ios/Project.xcodeproj')

    def test_cancel_terminates_child_process_group(self):
        with tempfile.TemporaryDirectory(prefix='orchard-worker-test-') as td:
            worker = object.__new__(runner.Worker)
            worker.directory = pathlib.Path(td)
            worker.child = None
            timer = threading.Timer(0.5, lambda: (worker.directory / 'cancel').touch())
            timer.start()
            start = time.monotonic()
            with self.assertRaises(runner.Cancelled):
                worker.run_command(['/bin/sleep', '20'])
            timer.join()
            self.assertLess(time.monotonic() - start, 5)
            self.assertIsNone(worker.child)


if __name__ == '__main__':
    unittest.main()
